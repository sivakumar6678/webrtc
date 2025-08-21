FROM python:3.10-slim
WORKDIR /app

# System deps for ONNX Runtime and image processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copy and install requirements
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY . .

# Expose port
EXPOSE 8000

# Healthcheck: FastAPI root should return 200
HEALTHCHECK CMD python -c "import urllib.request; import os; \
    import sys; \
    url='http://127.0.0.1:8000/'; \
    req=urllib.request.Request(url); \
    try:\n        urllib.request.urlopen(req, timeout=2)\n    except Exception as e:\n        sys.exit(1)" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]