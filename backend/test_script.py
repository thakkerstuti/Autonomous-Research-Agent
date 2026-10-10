import os
import time
import requests
import asyncio
import json

API_URL = "http://127.0.0.1:8001"

def download_paper():
    # Long paper: Llama 2 (arxiv 2307.09288) ~ 77 pages
    pdf_path = "llama2.pdf"
    if not os.path.exists(pdf_path):
        print("Downloading Llama 2 paper...")
        # Since arXiv can be slow/block, try another long sample if this fails, or use this.
        resp = requests.get("https://arxiv.org/pdf/2307.09288.pdf", stream=True)
        with open(pdf_path, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=8192): 
                f.write(chunk)
        print("Downloaded.")
    return pdf_path

def run_tests():
    pdf_path = download_paper()
    
    # 1. Upload paper
    print("Uploading paper...")
    with open(pdf_path, 'rb') as f:
        res = requests.post(f"{API_URL}/papers", data={"level": "Medium"}, files={"file": ("llama2.pdf", f, "application/pdf")})
    
    if res.status_code != 200:
        print(f"Failed to upload: {res.text}")
        return
        
    paper_id = res.json()["id"]
    print(f"Uploaded successfully. Paper ID: {paper_id}")
    
    # Track progress
    print("Watching progress using SSE...")
    # Read SSE (simulate)
    done_count = 0
    total_count = -1
    
    sse_resp = requests.get(f"{API_URL}/papers/{paper_id}/progress", stream=True)
    for line in sse_resp.iter_lines():
        if line:
            decoded_line = line.decode('utf-8')
            if decoded_line.startswith("data: "):
                data_str = decoded_line[6:]
                try:
                    data = json.loads(data_str)
                    print(f"Progress: {data}")
                    done_count = data["done"]
                    total_count = data["total"]
                    if done_count + data["failed"] == total_count and total_count > 0:
                        print("Job finished!")
                        break
                except Exception as e:
                    pass
                    
if __name__ == "__main__":
    run_tests()
