# Noderr Node OS Monitoring Stack

Comprehensive monitoring infrastructure for the Noderr decentralized trading network.

## Overview

The monitoring stack provides:
- **Log Aggregation** - Centralized logging with Loki
- **Metrics Collection** - Time-series metrics with Prometheus
- **Visualization** - Interactive dashboards with Grafana
- **Alerting** - Multi-channel alert routing with Alertmanager
- **System Metrics** - Node Exporter for host metrics
- **Container Metrics** - cAdvisor for Docker metrics

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Grafana (Port 3000)                      │
│              Visualization & Dashboards                      │
└──────────────┬──────────────────────┬─────────────────────┘
               │                      │
               ▼                      ▼
    ┌──────────────────┐   ┌──────────────────┐
    │  Prometheus      │   │  Loki            │
    │  (Port 9090)     │   │  (Port 3100)     │
    │  Metrics DB      │   │  Log Aggregation │
    └────────┬─────────┘   └────────┬─────────┘
             │                      │
             ▼                      ▼
    ┌─────────────────┐   ┌─────────────────┐
    │ Node Exporter   │   │ Promtail        │
    │ cAdvisor        │   │ Log Shipper     │
    │ Noderr Nodes    │   │                 │
    └─────────────────┘   └─────────────────┘
```

## Quick Start

### Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- 4GB RAM minimum (8GB recommended)
- 20GB disk space minimum

### 1. Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit configuration
nano .env
```

**Required environment variables:**

```bash
# Grafana
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=<strong-password>

# Alertmanager
SMTP_PASSWORD=<smtp-password>
WEBHOOK_URL=<webhook-url>  # Optional
```

### 2. Start Monitoring Stack

```bash
# Start all services
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f
```

### 3. Access Dashboards

- **Grafana**: http://localhost:3000
  - Username: `admin`
  - Password: (from `.env`)
  
- **Prometheus**: http://localhost:9090
- **Alertmanager**: http://localhost:9093

### 4. Verify Installation

```bash
# Check all services are healthy
docker-compose ps | grep healthy

# Test Prometheus targets
curl http://localhost:9090/api/v1/targets

# Test Loki
curl http://localhost:3100/ready

# Test Grafana
curl http://localhost:3000/api/health
```

## Components

### Loki (Log Aggregation)

**Port:** 3100  
**Data:** `/var/lib/docker/volumes/noderr-loki-data`

Loki aggregates logs from all Noderr nodes and system components.

**Configuration:** `config/loki-config.yml`

Key features:
- 30-day log retention
- 10MB/s ingestion rate
- Automatic log rotation
- Query optimization

**Querying logs:**

```bash
# Via Grafana Explore
# Or via API:
curl -G -s "http://localhost:3100/loki/api/v1/query_range" \
  --data-urlencode 'query={job="noderr"}' \
  --data-urlencode 'start=2024-01-01T00:00:00Z' \
  --data-urlencode 'end=2024-01-02T00:00:00Z'
```

### Promtail (Log Shipping)

Promtail ships logs from Docker containers and system files to Loki.

**Configuration:** `config/promtail-config.yml`

Monitored sources:
- Docker container logs (label: `noderr.node-os=true`)
- System logs (`/var/log/*.log`)
- Application logs (`/var/log/noderr/*.log`)

### Prometheus (Metrics)

**Port:** 9090  
**Data:** `/var/lib/docker/volumes/noderr-prometheus-data`

Prometheus collects and stores time-series metrics.

**Configuration:** `config/prometheus.yml`

**Scrape targets:**
- Prometheus self-monitoring (15s interval)
- Node Exporter - system metrics
- cAdvisor - container metrics
- Noderr nodes - application metrics (10s interval)
- Loki, Grafana, Alertmanager metrics

**Querying metrics:**

```bash
# Via Prometheus UI: http://localhost:9090/graph
# Or via API:
curl 'http://localhost:9090/api/v1/query?query=up'
```

### Node Exporter (System Metrics)

**Port:** 9100

Exports system-level metrics:
- CPU usage
- Memory usage
- Disk I/O
- Network statistics
- Filesystem usage

### cAdvisor (Container Metrics)

**Port:** 8080

Exports Docker container metrics:
- Container CPU usage
- Container memory usage
- Container network I/O
- Container filesystem usage

### Grafana (Visualization)

**Port:** 3000  
**Data:** `/var/lib/docker/volumes/noderr-grafana-data`

**Default Dashboards:**
- **Node Operations** - Real-time node status and health
- **System Metrics** - CPU, memory, disk, network
- **Container Metrics** - Docker container performance
- **Application Metrics** - Noderr-specific metrics

**Creating custom dashboards:**

1. Navigate to Dashboards → New Dashboard
2. Add panels with Prometheus or Loki queries
3. Save dashboard to `/monitoring/dashboards/`
4. Restart Grafana to load: `docker-compose restart grafana`

### Alertmanager (Alerting)

**Port:** 9093  
**Data:** `/var/lib/docker/volumes/noderr-alertmanager-data`

**Configuration:** `config/alertmanager.yml`

**Alert channels:**
- Email (SMTP)
- Webhook (Slack, Discord, PagerDuty)
- Custom webhooks

**Alert routing:**
- **Critical** → Immediate notification (10s wait, 30m repeat)
- **Warning** → Delayed notification (1m wait, 2h repeat)
- **Node Health** → Dedicated channel (30s wait, 1h repeat)
- **Update Failures** → Deployment team (1m wait, 1h repeat)

## Alert Rules

**Location:** `alerts/node-alerts.yml`

### Node Health Alerts

| Alert | Threshold | Duration | Severity |
|-------|-----------|----------|----------|
| NodeDown | Node unreachable | 2 minutes | Critical |
| HighCPUUsage | CPU > 80% | 10 minutes | Warning |
| CriticalCPUUsage | CPU > 95% | 5 minutes | Critical |
| HighMemoryUsage | Memory > 80% | 10 minutes | Warning |
| CriticalMemoryUsage | Memory > 95% | 5 minutes | Critical |
| HighDiskUsage | Disk > 80% | 15 minutes | Warning |
| CriticalDiskUsage | Disk > 95% | 5 minutes | Critical |

### Container Health Alerts

| Alert | Threshold | Duration | Severity |
|-------|-----------|----------|----------|
| ContainerRestarting | Frequent restarts | 5 minutes | Warning |
| ContainerHighCPU | CPU > 80% | 10 minutes | Warning |
| ContainerHighMemory | Memory > 80% | 10 minutes | Warning |

### Update Alerts

| Alert | Condition | Duration | Severity |
|-------|-----------|----------|----------|
| UpdateFailed | Update status = failed | 1 minute | Critical |
| UpdateRolledBack | Update rolled back | 1 minute | Warning |
| UpdateTakingTooLong | Update > 10 minutes | 1 minute | Warning |

### Application Alerts

| Alert | Threshold | Duration | Severity |
|-------|-----------|----------|----------|
| HighErrorRate | > 10 errors/s | 5 minutes | Warning |
| CriticalErrorRate | > 50 errors/s | 2 minutes | Critical |
| SlowResponseTime | P95 > 5s | 10 minutes | Warning |

## Customization

### Adding Alert Rules

1. Edit `alerts/node-alerts.yml`
2. Add new rule to appropriate group:

```yaml
- alert: MyCustomAlert
  expr: my_metric > threshold
  for: 5m
  labels:
    severity: warning
    category: custom
  annotations:
    summary: "Custom alert fired"
    description: "Metric {{ $labels.instance }} is {{ $value }}."
```

3. Reload Prometheus:

```bash
curl -X POST http://localhost:9090/-/reload
```

### Adding Dashboards

1. Create JSON dashboard in `dashboards/`
2. Restart Grafana:

```bash
docker-compose restart grafana
```

### Configuring Alert Channels

Edit `config/alertmanager.yml`:

**Slack:**

```yaml
- name: 'slack'
  slack_configs:
    - api_url: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL'
      channel: '#alerts'
      title: '{{ .GroupLabels.alertname }}'
      text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'
```

**Discord:**

```yaml
- name: 'discord'
  webhook_configs:
    - url: 'https://discord.com/api/webhooks/YOUR/WEBHOOK'
      send_resolved: true
```

**PagerDuty:**

```yaml
- name: 'pagerduty'
  pagerduty_configs:
    - service_key: 'YOUR_SERVICE_KEY'
      severity: '{{ .CommonLabels.severity }}'
```

## Maintenance

### Backup

```bash
# Backup all data volumes
docker run --rm \
  -v noderr-prometheus-data:/prometheus \
  -v noderr-loki-data:/loki \
  -v noderr-grafana-data:/grafana \
  -v $(pwd)/backups:/backup \
  ubuntu tar czf /backup/monitoring-backup-$(date +%Y%m%d).tar.gz \
  /prometheus /loki /grafana
```

### Restore

```bash
# Restore from backup
docker run --rm \
  -v noderr-prometheus-data:/prometheus \
  -v noderr-loki-data:/loki \
  -v noderr-grafana-data:/grafana \
  -v $(pwd)/backups:/backup \
  ubuntu tar xzf /backup/monitoring-backup-YYYYMMDD.tar.gz
```

### Cleanup

```bash
# Remove old logs and metrics (automatic via retention policies)
# Manual cleanup if needed:
docker-compose down
docker volume rm noderr-loki-data noderr-prometheus-data
docker-compose up -d
```

### Upgrade

```bash
# Pull latest images
docker-compose pull

# Restart services
docker-compose down
docker-compose up -d

# Verify
docker-compose ps
```

## Troubleshooting

### Services Won't Start

```bash
# Check logs
docker-compose logs <service-name>

# Common issues:
# 1. Port conflicts - change ports in docker-compose.yml
# 2. Permission issues - check volume permissions
# 3. Resource limits - increase Docker memory/CPU
```

### No Metrics Showing

```bash
# Check Prometheus targets
curl http://localhost:9090/api/v1/targets

# Verify scrape configs
docker-compose exec prometheus cat /etc/prometheus/prometheus.yml

# Check firewall rules
sudo ufw status
```

### No Logs in Loki

```bash
# Check Promtail is running
docker-compose ps promtail

# Verify Promtail config
docker-compose exec promtail cat /etc/promtail/config.yml

# Check Loki ingestion
curl http://localhost:3100/metrics | grep loki_ingester
```

### Alerts Not Firing

```bash
# Check alert rules are loaded
curl http://localhost:9090/api/v1/rules

# Verify Alertmanager config
docker-compose exec alertmanager cat /etc/alertmanager/alertmanager.yml

# Check alert status
curl http://localhost:9093/api/v2/alerts
```

## Performance Tuning

### High Memory Usage

Edit `config/prometheus.yml`:

```yaml
global:
  scrape_interval: 30s  # Increase from 15s
  evaluation_interval: 30s
```

Edit `config/loki-config.yml`:

```yaml
limits_config:
  ingestion_rate_mb: 5  # Decrease from 10
  retention_period: 7d  # Decrease from 30d
```

### High Disk Usage

```bash
# Reduce retention periods
# Prometheus: Edit --storage.tsdb.retention.time in docker-compose.yml
# Loki: Edit retention_period in config/loki-config.yml

# Compact data
docker-compose exec prometheus promtool tsdb compact /prometheus
```

## Security

### Secure Grafana

1. Change default password immediately
2. Enable HTTPS:

```yaml
# docker-compose.yml
grafana:
  environment:
    - GF_SERVER_PROTOCOL=https
    - GF_SERVER_CERT_FILE=/etc/grafana/ssl/cert.pem
    - GF_SERVER_CERT_KEY=/etc/grafana/ssl/key.pem
  volumes:
    - ./ssl:/etc/grafana/ssl:ro
```

### Restrict Access

Use firewall rules:

```bash
# Allow only from specific IPs
sudo ufw allow from 192.168.1.0/24 to any port 3000
sudo ufw allow from 192.168.1.0/24 to any port 9090
sudo ufw deny 3000
sudo ufw deny 9090
```

### Secure Alertmanager

Encrypt SMTP password:

```bash
# Use environment variable instead of plaintext
export SMTP_PASSWORD='your-password'
```

## Support

For issues or questions:
- Documentation: https://docs.noderr.network/monitoring
- GitHub Issues: https://github.com/Noderrxyz/noderr-node-os/issues
- Discord: https://discord.gg/noderr

## License

MIT License - See LICENSE file for details
