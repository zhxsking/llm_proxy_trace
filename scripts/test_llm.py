"""
LPT 端对端测试脚本 — 通过代理发送请求，验证 thinking + 正文透传

用法：
  python scripts/test_llm.py
  IS_STREAM=false python scripts/test_llm.py
"""

import os, sys
from openai import OpenAI

BASE_URL = os.getenv("LPT_BASE_URL", "http://localhost:19900/v1")
MODEL    = os.getenv("LPT_MODEL",    "ZhipuAI/GLM-5.1")
STREAM   = os.getenv("IS_STREAM", "true").lower() != "false"

client = OpenAI(api_key="any", base_url=BASE_URL)
MESSAGES = [
    {"role": "system", "content": "请用中文回答问题。"},
    {"role": "user",   "content": "用一句话介绍你自己。"},
]

print(f"=== LPT 测试  model={MODEL}  stream={STREAM} ===\n")

if STREAM:
    resp = client.chat.completions.create(model=MODEL, messages=MESSAGES, stream=True)
    thinking_done = False
    print("--- 思考过程 ---")
    for chunk in resp:
        if not chunk.choices:
            if hasattr(chunk, "usage") and chunk.usage:
                u = chunk.usage
                print(f"\nTokens: {u.prompt_tokens} + {u.completion_tokens} = {u.total_tokens}")
            continue
        delta = chunk.choices[0].delta
        if getattr(delta, "reasoning_content", None):
            print(delta.reasoning_content, end="", flush=True)
        if delta.content:
            if not thinking_done:
                print("\n--- 回答 ---")
                thinking_done = True
            print(delta.content, end="", flush=True)
    print()
else:
    resp = client.chat.completions.create(model=MODEL, messages=MESSAGES, stream=False)
    msg = resp.choices[0].message
    if getattr(msg, "reasoning_content", None):
        print("--- 思考过程 ---")
        print(msg.reasoning_content)
    print("--- 回答 ---")
    print(msg.content)
    if resp.usage:
        u = resp.usage
        print(f"\nTokens: {u.prompt_tokens} + {u.completion_tokens} = {u.total_tokens}")
