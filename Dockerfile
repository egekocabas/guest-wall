# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/data \
    PORT=8000
WORKDIR /app/backend
RUN groupadd --gid 65532 guestwall && useradd --uid 65532 --gid guestwall --no-create-home guestwall
COPY backend/ /app/backend/
RUN pip install --no-cache-dir .
COPY --from=frontend-build /build/frontend/dist/ /app/backend/guestwall/static/
COPY docker/entrypoint.sh /usr/local/bin/guestwall-entrypoint
RUN chmod 0555 /usr/local/bin/guestwall-entrypoint && mkdir -p /data && chown guestwall:guestwall /data
USER 65532:65532
EXPOSE 8000
VOLUME ["/data"]
ENTRYPOINT ["guestwall-entrypoint"]
CMD ["uvicorn", "guestwall.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips=*"]
