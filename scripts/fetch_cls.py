#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
fetch_cls.py · 抓财联社「电报」快讯 → cls-news.json

为什么需要这个脚本（2026-10-25 实测结论）：
  · 财联社新版接口 https://www.cls.cn/v1/roll/get_roll_list
    ① 需要 sign 签名（算法：md5(sha1(参数按 key 排序拼 k=v&...))）
    ② **没有 CORS 头** → 浏览器里 fetch 会被拦，脚本注入也拿不到（不是 JSONP）
  · 所以纯静态网页拿不到；解法是「服务端/定时任务抓 → 生成同源 JSON → 网页读同源文件」。
    网页端读 ./cls-news.json 是同源，没有 CORS 问题。

用法：
    python scripts/fetch_cls.py                    # 默认抓 30 条，写 finance-workbench/cls-news.json
    python scripts/fetch_cls.py --rn 50 --out x.json

数据结构（只保留前端要用的，控制体积）：
    { "updated": 1792912771, "source": "财联社电报", "count": 30,
      "items": [ { "id", "title", "brief", "ctime", "level", "url", "tags": [], "stocks": [] } ] }
"""
import argparse
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request

API = 'https://www.cls.cn/v1/roll/get_roll_list'
SV = '8.4.6'
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')


def sign_of(params):
    """财联社 sign：参数按 key 排序拼 k=v&...，两次哈希 sha1 → md5。"""
    raw = '&'.join('%s=%s' % (k, params[k]) for k in sorted(params))
    return hashlib.md5(hashlib.sha1(raw.encode('utf-8')).hexdigest().encode('utf-8')).hexdigest()


def fetch(rn=30, timeout=15):
    params = {
        'app': 'CailianpressWeb',
        'os': 'web',
        'sv': SV,
        'rn': str(rn),
    }
    params['sign'] = sign_of(params)
    url = API + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        'User-Agent': UA,
        'Referer': 'https://www.cls.cn/telegraph',
        'Accept': 'application/json, text/plain, */*',
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = json.loads(r.read().decode('utf-8'))
    if str(body.get('errno')) != '0':
        raise RuntimeError('财联社返回错误：errno=%s msg=%s' % (body.get('errno'), body.get('msg')))
    return (body.get('data') or {}).get('roll_data') or []


def clean_brief(title, brief):
    """去掉 brief 开头的【标题】和『财联社x月x日电，』这种通稿前缀，只留正文。"""
    text = str(brief or '').strip()
    if not text:
        return ''
    if text.startswith('【') and '】' in text:
        text = text.split('】', 1)[1].strip()
    for lead in ('财联社', '科创板日报', '智通财经'):
        if text.startswith(lead):
            # 财联社10月25日电， / 财联社25日讯，
            cut = text.find('电，')
            if cut < 0:
                cut = text.find('讯，')
            if 0 < cut < 24:
                text = text[cut + 2:].strip()
            break
    return text[:260]


def normalize(item, idx):
    tags, stocks = [], []
    try:
        for s in (item.get('subjects') or []):
            name = str(s.get('subject_name') or '').strip()
            if name and name not in tags:
                tags.append(name)
    except Exception:
        pass
    try:
        for s in (item.get('stock_list') or []):
            name = str(s.get('name') or s.get('stock_name') or '').strip()
            if name and name not in stocks:
                stocks.append(name)
    except Exception:
        pass
    ctime = int(item.get('ctime') or 0)
    title = str(item.get('title') or '').strip()
    brief = clean_brief(title, item.get('brief'))
    if not title and brief:
        title = brief[:48]
    return {
        'id': item.get('id') or ('idx%d' % idx),
        'title': title[:120],
        'brief': brief,
        'ctime': ctime,
        'level': str(item.get('level') or '').strip().upper(),
        'url': str(item.get('shareurl') or '').strip(),
        'tags': tags[:4],
        'stocks': stocks[:4],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rn', type=int, default=30, help='抓多少条（默认 30）')
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument('--out', default=os.path.join(os.path.dirname(here), 'cls-news.json'))
    ap.add_argument('--if-changed', action='store_true',
                    help='内容没变就不写文件（给定时任务用，避免无意义 commit）')
    args = ap.parse_args()

    try:
        roll = fetch(args.rn)
    except Exception as e:
        print('[cls] 抓取失败：%s' % e, file=sys.stderr)
        return 2
    if not roll:
        print('[cls] 返回空列表', file=sys.stderr)
        return 3

    items, seen = [], set()
    for i, it in enumerate(roll):
        if str(it.get('is_ad') or '') in ('1', 'True', 'true'):
            continue
        n = normalize(it, i)
        if not n['title'] or n['id'] in seen:
            continue
        seen.add(n['id'])
        items.append(n)

    # ⭐ 定时任务用：只比「条目 id 序列」，没新内容就不动文件（updated 也不刷新），
    #    免得每 10 分钟产生一个空 commit，仓库历史被刷满。
    if args.if_changed and os.path.exists(args.out):
        try:
            old = json.load(open(args.out, encoding='utf-8'))
            old_ids = set(str(x.get('id')) for x in (old.get('items') or []))
            new_ids = set(str(x.get('id')) for x in items)
            # 只比 id 集合：没有新电报（也没被窗口挤掉旧的）就一个字都不写，
            # updated 也不刷新 —— 否则每 10 分钟就多一个空 commit。
            if old_ids == new_ids:
                print('[cls] 内容无变化，跳过写入（%d 条）' % len(items))
                return 0
        except Exception:
            pass

    payload = {
        'updated': int(time.time()),
        'source': '财联社电报',
        'count': len(items),
        'items': items,
    }
    with open(args.out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
    size = os.path.getsize(args.out)
    newest = max((x['ctime'] for x in items), default=0)
    print('[cls] OK %d 条 → %s (%.1f KB) 最新 %s' % (
        len(items), args.out, size / 1024.0,
        time.strftime('%m-%d %H:%M', time.localtime(newest)) if newest else '-'))
    levels = {}
    for x in items:
        levels[x['level'] or '?'] = levels.get(x['level'] or '?', 0) + 1
    print('[cls] level 分布：%s' % ' '.join('%s=%d' % kv for kv in sorted(levels.items())))
    return 0


if __name__ == '__main__':
    sys.exit(main())
