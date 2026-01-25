"""
Noderr Telemetry Service
Lightweight query layer for node metrics and network statistics
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from supabase import create_client, Client
from typing import Optional, List, Dict, Any
import os
from datetime import datetime, timedelta

# Initialize FastAPI
app = FastAPI(
    title="Noderr Telemetry API",
    description="Real-time node metrics and network statistics",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Supabase client
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


@app.get("/api/telemetry/my-node")
async def get_my_node(wallet: str = Query(..., description="Wallet address")):
    """
    Get node status for a specific wallet address
    """
    try:
        # Get node identity by wallet
        # Note: You'll need to add wallet_address to node_identities table
        # or join through operator_applications table
        response = supabase.table("node_identities").select("*").execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="Node not found")
        
        # For now, return first node (you'll need to filter by wallet)
        node = response.data[0] if response.data else None
        
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        node_id = node["node_id"]
        
        # Get latest telemetry
        telemetry_response = supabase.table("node_telemetry")\
            .select("*")\
            .eq("node_id", node_id)\
            .order("timestamp", desc=True)\
            .limit(1)\
            .execute()
        
        latest_telemetry = telemetry_response.data[0] if telemetry_response.data else None
        
        # Calculate uptime status
        last_seen = node.get("last_seen")
        is_online = False
        if last_seen:
            last_seen_dt = datetime.fromisoformat(last_seen.replace('Z', '+00:00'))
            is_online = (datetime.utcnow() - last_seen_dt.replace(tzinfo=None)) < timedelta(minutes=5)
        
        return {
            "nodeId": node_id,
            "tier": node.get("tier"),
            "status": "online" if is_online else "offline",
            "uptime": latest_telemetry.get("uptime") if latest_telemetry else 0,
            "lastSeen": last_seen,
            "metrics": {
                "cpu": latest_telemetry.get("cpu_usage") if latest_telemetry else 0,
                "memory": latest_telemetry.get("memory_usage") if latest_telemetry else 0,
                "disk": latest_telemetry.get("disk_usage") if latest_telemetry else 0,
                "network": {
                    "rx": latest_telemetry.get("network_rx") if latest_telemetry else 0,
                    "tx": latest_telemetry.get("network_tx") if latest_telemetry else 0,
                }
            },
            "version": latest_telemetry.get("version") if latest_telemetry else "unknown"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/telemetry/network/summary")
async def get_network_summary():
    """
    Get network-wide statistics
    """
    try:
        # Get all nodes
        nodes_response = supabase.table("node_identities").select("*").execute()
        all_nodes = nodes_response.data or []
        
        # Count online nodes (last seen within 5 minutes)
        now = datetime.utcnow()
        online_nodes = 0
        for node in all_nodes:
            last_seen = node.get("last_seen")
            if last_seen:
                last_seen_dt = datetime.fromisoformat(last_seen.replace('Z', '+00:00'))
                if (now - last_seen_dt.replace(tzinfo=None)) < timedelta(minutes=5):
                    online_nodes += 1
        
        # Count by tier
        tier_counts = {}
        for node in all_nodes:
            tier = node.get("tier", "UNKNOWN")
            tier_counts[tier] = tier_counts.get(tier, 0) + 1
        
        # Get latest telemetry for average metrics
        telemetry_response = supabase.table("node_telemetry")\
            .select("*")\
            .gte("timestamp", (now - timedelta(minutes=5)).isoformat())\
            .execute()
        
        telemetry_data = telemetry_response.data or []
        
        avg_cpu = 0
        avg_memory = 0
        if telemetry_data:
            avg_cpu = sum(t.get("cpu_usage", 0) for t in telemetry_data) / len(telemetry_data)
            avg_memory = sum(t.get("memory_usage", 0) for t in telemetry_data) / len(telemetry_data)
        
        return {
            "totalNodes": len(all_nodes),
            "onlineNodes": online_nodes,
            "offlineNodes": len(all_nodes) - online_nodes,
            "tierDistribution": tier_counts,
            "averageMetrics": {
                "cpu": round(avg_cpu, 2),
                "memory": round(avg_memory, 2)
            },
            "timestamp": now.isoformat()
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/telemetry/nodes")
async def get_all_nodes(
    tier: Optional[str] = Query(None, description="Filter by tier"),
    status: Optional[str] = Query(None, description="Filter by status (online/offline)")
):
    """
    Get list of all nodes with their status
    """
    try:
        # Get all nodes
        query = supabase.table("node_identities").select("*")
        
        if tier:
            query = query.eq("tier", tier)
        
        response = query.execute()
        nodes = response.data or []
        
        # Enrich with telemetry data
        now = datetime.utcnow()
        result = []
        
        for node in nodes:
            node_id = node["node_id"]
            last_seen = node.get("last_seen")
            
            # Determine online status
            is_online = False
            if last_seen:
                last_seen_dt = datetime.fromisoformat(last_seen.replace('Z', '+00:00'))
                is_online = (now - last_seen_dt.replace(tzinfo=None)) < timedelta(minutes=5)
            
            # Filter by status if requested
            if status:
                if status == "online" and not is_online:
                    continue
                if status == "offline" and is_online:
                    continue
            
            # Get latest telemetry
            telemetry_response = supabase.table("node_telemetry")\
                .select("*")\
                .eq("node_id", node_id)\
                .order("timestamp", desc=True)\
                .limit(1)\
                .execute()
            
            latest_telemetry = telemetry_response.data[0] if telemetry_response.data else None
            
            result.append({
                "nodeId": node_id,
                "tier": node.get("tier"),
                "status": "online" if is_online else "offline",
                "lastSeen": last_seen,
                "uptime": latest_telemetry.get("uptime") if latest_telemetry else 0,
                "cpu": latest_telemetry.get("cpu_usage") if latest_telemetry else 0,
                "memory": latest_telemetry.get("memory_usage") if latest_telemetry else 0,
                "version": latest_telemetry.get("version") if latest_telemetry else "unknown"
            })
        
        return {
            "nodes": result,
            "total": len(result),
            "timestamp": now.isoformat()
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/telemetry/alerts")
async def get_alerts():
    """
    Get active alerts for nodes
    """
    try:
        # Check for nodes that haven't reported in >10 minutes
        now = datetime.utcnow()
        threshold = now - timedelta(minutes=10)
        
        response = supabase.table("node_identities")\
            .select("*")\
            .eq("status", "ACTIVE")\
            .execute()
        
        nodes = response.data or []
        alerts = []
        
        for node in nodes:
            last_seen = node.get("last_seen")
            if not last_seen:
                alerts.append({
                    "nodeId": node["node_id"],
                    "tier": node.get("tier"),
                    "severity": "warning",
                    "message": "Node has never reported",
                    "timestamp": now.isoformat()
                })
                continue
            
            last_seen_dt = datetime.fromisoformat(last_seen.replace('Z', '+00:00'))
            if last_seen_dt.replace(tzinfo=None) < threshold:
                minutes_offline = int((now - last_seen_dt.replace(tzinfo=None)).total_seconds() / 60)
                alerts.append({
                    "nodeId": node["node_id"],
                    "tier": node.get("tier"),
                    "severity": "critical" if minutes_offline > 60 else "warning",
                    "message": f"Node offline for {minutes_offline} minutes",
                    "timestamp": now.isoformat(),
                    "lastSeen": last_seen
                })
        
        return {
            "alerts": alerts,
            "total": len(alerts),
            "timestamp": now.isoformat()
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
