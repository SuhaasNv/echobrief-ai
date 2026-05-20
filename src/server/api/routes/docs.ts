/**
 * API Documentation Route
 * 
 * Serves human-readable API documentation at /api/v1/docs
 * 
 * Alternative to OpenAPI/Swagger (which has zod v4 dependency conflicts).
 * Provides simple, clear documentation for external integrations.
 */

import { Hono } from "hono";
import type { AppBindings } from "../types";

const app = new Hono<AppBindings>();

// API Documentation (HTML)
app.get("/", (c) => {
  const baseUrl = process.env.APP_URL || "https://api.echobrief.ai";
  
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EchoBrief API Documentation</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
      background: #f5f5f5;
    }
    h1 { color: #10b981; margin-bottom: 0.5rem; }
    h2 { color: #059669; margin-top: 2rem; margin-bottom: 1rem; border-bottom: 2px solid #10b981; padding-bottom: 0.5rem; }
    h3 { color: #047857; margin-top: 1.5rem; margin-bottom: 0.75rem; }
    code {
      background: #1f2937;
      color: #10b981;
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 0.9em;
    }
    pre {
      background: #1f2937;
      color: #e5e7eb;
      padding: 1rem;
      border-radius: 5px;
      overflow-x: auto;
      margin: 1rem 0;
    }
    pre code { background: none; color: inherit; padding: 0; }
    .endpoint {
      background: white;
      padding: 1.5rem;
      margin: 1rem 0;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .method {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 4px;
      font-weight: bold;
      font-size: 0.85em;
      margin-right: 0.5rem;
    }
    .get { background: #10b981; color: white; }
    .post { background: #3b82f6; color: white; }
    .put { background: #f59e0b; color: white; }
    .delete { background: #ef4444; color: white; }
    .path { font-family: 'Monaco', monospace; color: #047857; }
    .auth { background: #fef3c7; padding: 1rem; border-left: 4px solid #f59e0b; margin: 1rem 0; }
    .error { background: #fee2e2; padding: 1rem; border-left: 4px solid #ef4444; margin: 1rem 0; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
      background: white;
    }
    th, td {
      text-align: left;
      padding: 0.75rem;
      border: 1px solid #e5e7eb;
    }
    th { background: #f9fafb; font-weight: 600; }
  </style>
</head>
<body>
  <h1>EchoBrief API Documentation</h1>
  <p><strong>Base URL:</strong> <code>${baseUrl}/api/v1</code></p>
  <p><strong>Version:</strong> 1.0.0</p>
  
  <h2>Authentication</h2>
  <div class="auth">
    <p>All authenticated endpoints require a Bearer token in the Authorization header:</p>
    <pre><code>Authorization: Bearer &lt;your_jwt_token&gt;</code></pre>
    <p>Obtain a token by logging in via <code>POST /auth/login</code></p>
  </div>
  
  <h2>Rate Limits</h2>
  <table>
    <thead>
      <tr><th>Tier</th><th>General Endpoints</th><th>AI Endpoints</th></tr>
    </thead>
    <tbody>
      <tr><td>Free</td><td>100 req/min</td><td>10 req/min</td></tr>
      <tr><td>Student</td><td>300 req/min</td><td>50 req/min</td></tr>
      <tr><td>Pro</td><td>500 req/min</td><td>100 req/min</td></tr>
      <tr><td>Team</td><td>2000 req/min</td><td>500 req/min</td></tr>
    </tbody>
  </table>
  
  <h2>Authentication Endpoints</h2>
  
  <div class="endpoint">
    <h3><span class="method post">POST</span> <span class="path">/auth/signup</span></h3>
    <p>Create a new user account</p>
    <pre><code>{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe"
}</code></pre>
    <p><strong>Response:</strong> <code>201 Created</code></p>
    <pre><code>{
  "user": { "id": "...", "email": "...", "name": "..." },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}</code></pre>
  </div>
  
  <div class="endpoint">
    <h3><span class="method post">POST</span> <span class="path">/auth/login</span></h3>
    <p>Login with email and password</p>
    <pre><code>{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}</code></pre>
    <p><strong>Response:</strong> <code>200 OK</code></p>
    <pre><code>{
  "user": { "id": "...", "email": "...", "name": "..." },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}</code></pre>
  </div>
  
  <h2>Health Endpoints</h2>
  
  <div class="endpoint">
    <h3><span class="method get">GET</span> <span class="path">/health</span></h3>
    <p>Liveness probe - checks if service is running</p>
    <p><strong>Response:</strong> <code>200 OK</code></p>
    <pre><code>{
  "ok": true,
  "service": "echobrief-api",
  "timestamp": 1716183000000
}</code></pre>
  </div>
  
  <div class="endpoint">
    <h3><span class="method get">GET</span> <span class="path">/ready</span></h3>
    <p>Readiness probe - checks if service can handle traffic</p>
    <p><strong>Response:</strong> <code>200 OK</code> (ready) or <code>503 Service Unavailable</code> (not ready)</p>
    <pre><code>{
  "ready": true,
  "checks": {
    "database": true,
    "redis": true
  },
  "latencies": {
    "database_ms": 5,
    "redis_ms": 2
  },
  "timestamp": 1716183000000
}</code></pre>
  </div>
  
  <h2>Meeting Endpoints</h2>
  
  <div class="endpoint">
    <h3><span class="method get">GET</span> <span class="path">/meetings</span></h3>
    <p>List all meetings for current workspace</p>
    <p><strong>Auth:</strong> Required</p>
    <p><strong>Headers:</strong> <code>x-workspace-id: &lt;workspace_id&gt;</code></p>
    <p><strong>Response:</strong> <code>200 OK</code></p>
    <pre><code>{
  "meetings": [
    {
      "id": "...",
      "title": "Team Standup",
      "created_at": "2026-05-20T12:00:00Z",
      "status": "completed",
      "duration_sec": 1800
    }
  ]
}</code></pre>
  </div>
  
  <div class="endpoint">
    <h3><span class="method post">POST</span> <span class="path">/meetings</span></h3>
    <p>Create a new meeting</p>
    <p><strong>Auth:</strong> Required</p>
    <p><strong>Headers:</strong> <code>x-workspace-id: &lt;workspace_id&gt;</code></p>
    <pre><code>{
  "title": "Team Standup",
  "audio_file": "&lt;multipart/form-data&gt;",
  "language": "en"
}</code></pre>
    <p><strong>Response:</strong> <code>201 Created</code></p>
    <pre><code>{
  "meeting": {
    "id": "...",
    "title": "Team Standup",
    "status": "processing"
  }
}</code></pre>
  </div>
  
  <div class="endpoint">
    <h3><span class="method get">GET</span> <span class="path">/meetings/:id</span></h3>
    <p>Get meeting details including transcript and summary</p>
    <p><strong>Auth:</strong> Required</p>
    <p><strong>Response:</strong> <code>200 OK</code></p>
    <pre><code>{
  "meeting": {
    "id": "...",
    "title": "Team Standup",
    "transcript": "...",
    "summary": "...",
    "action_items": [...],
    "status": "completed"
  }
}</code></pre>
  </div>
  
  <h2>Admin Endpoints</h2>
  
  <div class="endpoint">
    <h3><span class="method get">GET</span> <span class="path">/admin/workers/stats</span></h3>
    <p>Get worker queue statistics</p>
    <p><strong>Auth:</strong> Required (Admin only)</p>
    <p><strong>Response:</strong> <code>200 OK</code></p>
    <pre><code>{
  "processing_queue": {
    "waiting": 5,
    "active": 10,
    "completed": 1000,
    "failed": 2,
    "health": "healthy"
  },
  "export_queue": {
    "waiting": 0,
    "active": 1,
    "completed": 50,
    "failed": 0,
    "health": "healthy"
  }
}</code></pre>
  </div>
  
  <h2>Error Responses</h2>
  
  <div class="error">
    <p>All errors return a JSON response with <code>error</code> and optional <code>message</code> fields:</p>
    <pre><code>{
  "error": "unauthorized",
  "message": "Invalid or expired token"
}</code></pre>
    <p><strong>Common Error Codes:</strong></p>
    <ul>
      <li><code>400</code> - Bad Request (invalid input)</li>
      <li><code>401</code> - Unauthorized (missing/invalid token)</li>
      <li><code>403</code> - Forbidden (insufficient permissions)</li>
      <li><code>404</code> - Not Found (resource doesn't exist)</li>
      <li><code>413</code> - Request Too Large (payload > 10MB)</li>
      <li><code>429</code> - Rate Limited (too many requests)</li>
      <li><code>500</code> - Internal Server Error</li>
    </ul>
  </div>
  
  <h2>Webhooks</h2>
  
  <p>Configure webhooks to receive real-time notifications when events occur:</p>
  
  <h3>Events</h3>
  <ul>
    <li><code>meeting.created</code> - Meeting created</li>
    <li><code>meeting.processing</code> - Meeting processing started</li>
    <li><code>meeting.completed</code> - Meeting processing completed</li>
    <li><code>meeting.failed</code> - Meeting processing failed</li>
    <li><code>export.completed</code> - Data export ready</li>
  </ul>
  
  <h3>Webhook Payload</h3>
  <pre><code>{
  "event": "meeting.completed",
  "timestamp": "2026-05-20T12:00:00Z",
  "data": {
    "meeting_id": "...",
    "title": "Team Standup",
    "duration_sec": 1800
  }
}</code></pre>
  
  <h2>SDKs & Libraries</h2>
  
  <p>Official client libraries coming soon. For now, use standard HTTP libraries:</p>
  
  <h3>JavaScript/TypeScript</h3>
  <pre><code>const response = await fetch('${baseUrl}/api/v1/meetings', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'x-workspace-id': 'YOUR_WORKSPACE_ID'
  }
});
const data = await response.json();</code></pre>
  
  <h3>Python</h3>
  <pre><code>import requests

response = requests.get(
  '${baseUrl}/api/v1/meetings',
  headers={
    'Authorization': 'Bearer YOUR_TOKEN',
    'x-workspace-id': 'YOUR_WORKSPACE_ID'
  }
)
data = response.json()</code></pre>
  
  <h2>Support</h2>
  
  <p>Questions? Contact us:</p>
  <ul>
    <li><strong>Email:</strong> support@echobrief.ai</li>
    <li><strong>Docs:</strong> docs.echobrief.ai</li>
    <li><strong>Status:</strong> status.echobrief.ai</li>
  </ul>
  
  <footer style="margin-top: 3rem; padding-top: 2rem; border-top: 1px solid #e5e7eb; color: #6b7280; text-align: center;">
    <p>EchoBrief API Documentation v1.0.0 &bull; Last Updated: 2026-05-20</p>
  </footer>
</body>
</html>
  `);
});

export default app;
