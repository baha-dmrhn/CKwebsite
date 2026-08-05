FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=10000

WORKDIR /app

COPY ["CK-ENERJI-WEBSITE/requirements.txt", "./requirements.txt"]
RUN pip install --no-cache-dir -r requirements.txt

COPY ["CK-ENERJI-WEBSITE", "./CK-ENERJI-WEBSITE"]
COPY ["UEVM-UEÇM", "./UEVM-UEÇM"]
COPY ["SMF-PTF-YAL-YAT/public", "./SMF-PTF-YAL-YAT/public"]
COPY ["BARAJ AKTİF/templates", "./BARAJ AKTİF/templates"]

EXPOSE 10000

CMD ["python", "CK-ENERJI-WEBSITE/app.py"]
