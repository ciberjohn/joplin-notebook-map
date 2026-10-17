FROM python:3.12-slim-bookworm@sha256:090ba77e2958f6af52a5341f788b50b032dd4ca28377d2893dcf1ecbdfdfe203

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY app/requirements.txt .
RUN pip install --no-cache-dir --require-hashes -r requirements.txt

COPY app/ .

# Non-root runtime user (uid 10001). No shell, no privileges.
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8910

CMD ["python", "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8910", "--no-access-log"]
