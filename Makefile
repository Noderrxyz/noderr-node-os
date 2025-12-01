.PHONY: help build up down restart logs clean test

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Build all Docker images
	@echo "Building Docker images..."
	docker-compose build --parallel

up: ## Start all services
	@echo "Starting Noderr Node OS..."
	docker-compose up -d
	@echo "Waiting for services to be healthy..."
	@sleep 10
	@docker-compose ps

down: ## Stop all services
	@echo "Stopping Noderr Node OS..."
	docker-compose down

restart: down up ## Restart all services

logs: ## Show logs from all services
	docker-compose logs -f

logs-node: ## Show logs from node-runtime
	docker-compose logs -f node-runtime

logs-ml: ## Show logs from ML service
	docker-compose logs -f ml-service

logs-db: ## Show logs from database
	docker-compose logs -f postgres

ps: ## Show running containers
	docker-compose ps

clean: ## Remove all containers, volumes, and images
	@echo "Cleaning up..."
	docker-compose down -v --rmi all
	@echo "Cleanup complete"

clean-volumes: ## Remove all volumes (WARNING: deletes data)
	@echo "Removing volumes..."
	docker-compose down -v
	@echo "Volumes removed"

shell-node: ## Open shell in node-runtime container
	docker-compose exec node-runtime sh

shell-ml: ## Open shell in ML service container
	docker-compose exec ml-service bash

shell-db: ## Open psql shell in database
	docker-compose exec postgres psql -U noderr -d noderr

test: ## Run tests in containers
	@echo "Running tests..."
	docker-compose exec node-runtime pnpm test

health: ## Check health of all services
	@echo "Checking service health..."
	@curl -f http://localhost/health && echo "✓ Nginx healthy" || echo "✗ Nginx unhealthy"
	@curl -f http://localhost:8080/health && echo "✓ Node Runtime healthy" || echo "✗ Node Runtime unhealthy"
	@docker-compose exec -T postgres pg_isready -U noderr && echo "✓ PostgreSQL healthy" || echo "✗ PostgreSQL unhealthy"
	@docker-compose exec -T redis redis-cli ping | grep -q PONG && echo "✓ Redis healthy" || echo "✗ Redis unhealthy"

stats: ## Show resource usage
	docker stats --no-stream

backup-db: ## Backup database
	@echo "Backing up database..."
	@mkdir -p backups
	docker-compose exec -T postgres pg_dump -U noderr noderr > backups/noderr_$(shell date +%Y%m%d_%H%M%S).sql
	@echo "Backup complete"

restore-db: ## Restore database from backup (usage: make restore-db FILE=backup.sql)
	@if [ -z "$(FILE)" ]; then echo "Usage: make restore-db FILE=backup.sql"; exit 1; fi
	@echo "Restoring database from $(FILE)..."
	docker-compose exec -T postgres psql -U noderr -d noderr < $(FILE)
	@echo "Restore complete"

init: ## Initialize environment
	@echo "Initializing Noderr Node OS..."
	@if [ ! -f .env ]; then cp .env.example .env; echo "Created .env file"; fi
	@echo "Building images..."
	@make build
	@echo "Starting services..."
	@make up
	@echo "Initialization complete!"

dev: ## Start in development mode with hot reload
	docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

prod: ## Start in production mode
	@echo "Starting in production mode..."
	docker-compose up -d
	@echo "Production deployment complete"

update: ## Update and rebuild services
	@echo "Updating services..."
	git pull
	make build
	make restart
	@echo "Update complete"
