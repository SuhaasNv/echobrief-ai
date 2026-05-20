/**
 * k6 Load Test - API Stress Test
 * 
 * Simulates realistic production traffic patterns to validate:
 * - API response times under load
 * - Rate limiting behavior
 * - Database connection pooling
 * - Redis connection pooling
 * - Worker queue throughput
 * 
 * Run:
 *   k6 run tests/load/api-stress.js
 * 
 * With custom parameters:
 *   API_URL=https://api.echobrief.ai TEST_TOKEN=your-jwt k6 run tests/load/api-stress.js
 * 
 * Test Stages:
 *   1. Warm-up:  0 → 100 users over 2 minutes
 *   2. Sustain:  100 users for 5 minutes
 *   3. Spike:    100 → 1000 users over 2 minutes
 *   4. Hold:     1000 users for 5 minutes
 *   5. Ramp-down: 1000 → 0 over 2 minutes
 * 
 * Success Criteria:
 *   - p95 response time < 500ms
 *   - Error rate < 1%
 *   - No database/Redis connection exhaustion
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Custom metrics
const apiResponseTime = new Trend('api_response_time');
const dbErrors = new Counter('db_errors');
const rateLimitErrors = new Counter('rate_limit_errors');

// Test configuration
export let options = {
  stages: [
    { duration: '2m', target: 100 },    // Warm-up: ramp to 100 users
    { duration: '5m', target: 100 },    // Sustain: hold 100 users
    { duration: '2m', target: 1000 },   // Spike: ramp to 1K users
    { duration: '5m', target: 1000 },   // Hold: sustain 1K users
    { duration: '2m', target: 0 },      // Ramp-down: graceful exit
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500'],      // 95% of requests under 500ms
    'http_req_failed': ['rate<0.01'],        // <1% error rate
    'api_response_time': ['p(95)<500'],      // Custom metric threshold
  },
};

// Environment variables
const BASE_URL = __ENV.API_URL || 'http://localhost:3000';
const TEST_TOKEN = __ENV.TEST_TOKEN || '';

if (!TEST_TOKEN) {
  console.warn('⚠️  TEST_TOKEN not set - authenticated endpoints will fail');
}

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${TEST_TOKEN}`,
};

/**
 * Main test function - runs once per VU iteration.
 */
export default function() {
  // Test 1: Health check (public endpoint)
  {
    const res = http.get(`${BASE_URL}/api/v1/health`);
    check(res, {
      'health check status 200': (r) => r.status === 200,
      'health check has ok field': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.ok === true;
        } catch {
          return false;
        }
      },
    });
    
    apiResponseTime.add(res.timings.duration);
  }
  
  sleep(0.5);
  
  // Test 2: List meetings (authenticated endpoint)
  if (TEST_TOKEN) {
    const res = http.get(`${BASE_URL}/api/v1/meetings`, { headers });
    
    const success = check(res, {
      'meetings list status 200 or 429': (r) => r.status === 200 || r.status === 429,
      'meetings list response time OK': (r) => r.timings.duration < 1000,
    });
    
    if (res.status === 429) {
      rateLimitErrors.add(1);
    } else if (res.status >= 500) {
      dbErrors.add(1);
    }
    
    apiResponseTime.add(res.timings.duration);
  }
  
  sleep(1);
  
  // Test 3: Get subscription status (cached endpoint - should be fast)
  if (TEST_TOKEN) {
    const res = http.get(`${BASE_URL}/api/v1/subscription`, { headers });
    
    check(res, {
      'subscription status 200 or 429': (r) => r.status === 200 || r.status === 429,
      'subscription response time OK': (r) => r.timings.duration < 500, // Should be fast (cached)
    });
    
    if (res.status === 429) {
      rateLimitErrors.add(1);
    }
    
    apiResponseTime.add(res.timings.duration);
  }
  
  sleep(1);
  
  // Test 4: Readiness probe (checks DB, Redis, Queue)
  {
    const res = http.get(`${BASE_URL}/api/v1/ready`);
    
    check(res, {
      'readiness probe returns status': (r) => r.status === 200 || r.status === 503,
      'readiness probe response time OK': (r) => r.timings.duration < 2000,
    });
    
    // 503 indicates unhealthy dependencies
    if (res.status === 503) {
      dbErrors.add(1);
    }
    
    apiResponseTime.add(res.timings.duration);
  }
  
  sleep(2);
}

/**
 * Setup - runs once per VU before test starts.
 */
export function setup() {
  console.log(`🚀 Load test starting against ${BASE_URL}`);
  console.log(`📊 Stages: ${JSON.stringify(options.stages)}`);
  console.log(`🎯 Thresholds: ${JSON.stringify(options.thresholds)}`);
  
  // Verify API is reachable
  const res = http.get(`${BASE_URL}/api/v1/health`);
  if (res.status !== 200) {
    throw new Error(`API not reachable: ${res.status} ${res.body}`);
  }
  
  return { startTime: Date.now() };
}

/**
 * Teardown - runs once after test completes.
 */
export function teardown(data) {
  const durationSec = (Date.now() - data.startTime) / 1000;
  console.log(`✅ Load test completed in ${durationSec.toFixed(0)}s`);
}
