# CogNexa — Autonomous Research & Paper Intelligence Agent

✦ **CogNexa** is an autonomous, evidence-tracked AI research agent and paper intelligence platform built with **Next.js 14 (App Router)** and a **FastAPI** backend service.

---

## 🌟 Key Features

- **🧠 Dual-Mode Agent Execution**:
  - **Research Mode**: Investigate complex open questions with step-by-step reasoning and web evidence retrieval.
  - **Paper Study Mode**: Deep-dive into academic papers, extract key findings, and generate structured notes.
- **📊 Real-time Evidence & Confidence Graph**: Source confidence scoring with SSE streaming execution logs.
- **🔐 Modern Auth & Dashboard Workspace**: Complete authentication interface (Login, Sign Up, Quick Demo Mode, ORCID academic identity support).
- **⚡ FastAPI Backend Engine**: Automated query decomposition, LLM reasoning loops, and structured research schema output.

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: Next.js 14 (App Router), TypeScript, React 18
- **Styling**: Tailwind CSS, CSS variables, glassmorphic UI components
- **State & Data Fetching**: Zustand, TanStack Query (React Query)
- **Icons & UI Primitives**: Lucide React, Radix UI Primitives, Recharts

### Backend
- **Framework**: FastAPI, Uvicorn
- **AI & Data Processing**: Python 3.10+, Pydantic
- **Search & LLM Integration**: Multi-source web search & LLM synthesis pipeline

---

## 🚀 Quick Start

### 1. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 2. Backend Setup
```bash
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

---

## 👥 Contributors

This project is co-created and maintained by:

- 👩‍💻 **Stuti Thakker** — [@thakkerstuti](https://github.com/thakkerstuti)
- 👩‍💻 **Vanshika Sultania** — [@VanshikaSultania](https://github.com/VanshikaSultania)

---

## 📄 License

MIT License © 2026 CogNexa Team
