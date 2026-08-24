.PHONY: install dev-backend dev-frontend test lint build

install:
	python3 -m venv .venv
	.venv/bin/pip install -e 'backend[dev]'
	cd frontend && npm ci

dev-backend:
	cd backend && ../.venv/bin/alembic upgrade head && ../.venv/bin/uvicorn guestwall.main:app --reload

dev-frontend:
	cd frontend && npm run dev -- --host 0.0.0.0

test:
	cd backend && ../.venv/bin/pytest
	cd frontend && npm test

lint:
	cd backend && ../.venv/bin/ruff format --check . && ../.venv/bin/ruff check . && ../.venv/bin/mypy guestwall
	cd frontend && npm run format:check && npm run lint

build:
	cd frontend && npm run build
	docker build -t guestwall:local .

