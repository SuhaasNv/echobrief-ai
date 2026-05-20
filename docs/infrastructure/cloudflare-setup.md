# Cloudflare DDoS Protection & Security Setup

**Purpose:** Configure Cloudflare as a protective edge layer for EchoBrief AI production deployment.

**Benefits:**
- Edge-level DDoS protection (automatic mitigation)
- WAF (Web Application Firewall) with managed rulesets
- Bot management and challenge pages
- Global CDN for static assets
- Rate limiting at network edge (before hitting Railway)

---

## Prerequisites

- Domain registered (echobrief.ai)
- Cloudflare account (Free tier works, Pro recommended)
- Railway production deployment active

---

## 1. DNS Setup

### Step 1: Add Domain to Cloudflare

1. Log in to Cloudflare dashboard
2. Click "Add a site"
3. Enter `echobrief.ai`
4. Select Free plan (or Pro for advanced features)
5. Cloudflare will scan existing DNS records

### Step 2: Update Nameservers

1. Copy Cloudflare nameservers (e.g., `ns1.cloudflare.com`, `ns2.cloudflare.com`)
2. Go to your domain registrar (Namecheap, GoDaddy, etc.)
3. Update nameservers to Cloudflare's
4. Wait for DNS propagation (usually 5-30 minutes)

### Step 3: Configure DNS Records

```
Type    Name          Content                           Proxy Status
----    ----          -------                           ------------
A       @             <Railway IP or CNAME>             Proxied (🧡 orange cloud)
CNAME   www           echobrief.ai                      Proxied (🧡 orange cloud)
CNAME   api           <Railway API domain>              Proxied (🧡 orange cloud)
TXT     _vercel       <verification code if needed>     DNS only
```

**IMPORTANT:** Enable "Proxied" (orange cloud) for protection. Grey cloud = DNS only (no protection).

---

## 2. SSL/TLS Configuration

### Recommended Settings

1. Navigate to **SSL/TLS** → **Overview**
2. Set encryption mode: **Full (strict)**
   - Ensures end-to-end encryption
   - Cloudflare validates Railway's SSL certificate
3. Enable **Always Use HTTPS**
4. Enable **Automatic HTTPS Rewrites**
5. Set **Minimum TLS Version**: TLS 1.2

### HSTS Configuration

1. Navigate to **SSL/TLS** → **Edge Certificates**
2. Enable **HTTP Strict Transport Security (HSTS)**
   - Max Age: 12 months (31536000 seconds)
   - Include subdomains: Yes
   - Preload: Yes (after testing)

---

## 3. Firewall Rules (Rate Limiting)

### Rule 1: Aggressive IP Rate Limiting

**Purpose:** Block IPs making excessive requests across the site.

```
Name: Block Aggressive IPs
When incoming requests match:
  - Rate: >1000 requests per 10 seconds
  - From: Single IP address
Then:
  - Block
  - Duration: 1 hour
```

**Configure:**
1. Navigate to **Security** → **WAF** → **Rate limiting rules**
2. Click "Create rate limiting rule"
3. Set threshold: 1000 requests / 10 seconds
4. Action: Block
5. Duration: 1 hour

---

### Rule 2: API Endpoint Protection

**Purpose:** Prevent abuse of expensive API endpoints.

```
Name: API Abuse Protection
When incoming requests match:
  - Path: /api/v1/meetings/*
  - Rate: >100 requests per minute
  - From: Single IP address
Then:
  - Challenge (Managed Challenge)
```

**Configure:**
1. Create rate limiting rule
2. Path contains: `/api/v1/meetings/`
3. Threshold: 100 requests / 1 minute
4. Action: Managed Challenge (CAPTCHA)

---

### Rule 3: Signup Endpoint Protection

**Purpose:** Prevent automated account creation spam.

```
Name: Signup Spam Protection
When incoming requests match:
  - Path: /api/v1/auth/signup
  - Rate: >10 requests per hour
  - From: Single IP address
Then:
  - Block
  - Duration: 24 hours
```

---

### Rule 4: Geographic Restrictions (Optional)

**Purpose:** Block traffic from high-abuse regions if needed.

```
Name: Geographic Restrictions
When incoming requests match:
  - Country: <High-abuse countries list>
Then:
  - Challenge (Managed Challenge)
```

**Note:** Only enable if you see abuse from specific regions and don't serve users there.

---

## 4. WAF (Web Application Firewall)

### Managed Rulesets

1. Navigate to **Security** → **WAF** → **Managed rules**
2. Enable the following rulesets:

#### a) Cloudflare Managed Ruleset
- **Status:** Enabled
- **Action:** Block
- **Sensitivity:** Medium

Protects against:
- SQL injection
- XSS (Cross-site scripting)
- Command injection
- Path traversal
- Log4j exploits

#### b) OWASP Core Ruleset
- **Status:** Enabled
- **Action:** Block
- **Paranoia Level:** PL2 (Medium)

Industry-standard protection against OWASP Top 10 vulnerabilities.

#### c) Cloudflare Specials
- **Status:** Enabled
- **Action:** Block

Blocks known malicious patterns and attack tools.

---

### Custom WAF Rules (Optional)

#### Block Suspicious User-Agents

```
Expression:
  (http.user_agent contains "sqlmap") or
  (http.user_agent contains "nikto") or
  (http.user_agent contains "nmap") or
  (http.user_agent eq "")
  
Action: Block
```

#### Protect Admin Endpoints

```
Expression:
  (http.request.uri.path contains "/api/v1/admin") and
  (ip.geoip.country ne "US")
  
Action: Challenge (Managed Challenge)
```

---

## 5. Bot Management

### Free Tier Settings

1. Navigate to **Security** → **Bots**
2. Enable **Bot Fight Mode** (Free tier)
   - Automatically challenges suspected bots
   - Uses machine learning to identify malicious traffic

### Pro/Business Tier Settings (Optional)

If you upgrade to Pro:
- **Super Bot Fight Mode**: More advanced bot detection
- **JavaScript Detection**: Challenges browsers without JS
- **Verified Bots**: Allow known good bots (Google, Bing crawlers)

---

## 6. DDoS Protection

Cloudflare provides automatic DDoS protection at all plan levels:

- **Network Layer (L3/L4):** Automatic mitigation for SYN floods, UDP floods
- **Application Layer (L7):** HTTP flood protection
- **DNS Amplification:** Protection against DNS-based attacks

### Advanced DDoS Alerts (Pro+)

1. Navigate to **Security** → **DDoS**
2. Enable **Advanced TCP Protection**
3. Enable **Advanced DNS Protection**
4. Configure email alerts for DDoS events

---

## 7. Caching Configuration

### Cache Rules

1. Navigate to **Caching** → **Cache Rules**
2. Create rules for static assets:

```
Rule: Cache Static Assets
When incoming requests match:
  - File extension is one of: .js, .css, .jpg, .png, .svg, .woff2
Then:
  - Cache eligible resources: Cache all
  - Edge TTL: 1 month
  - Browser TTL: 1 week
```

### API Response Caching (Optional)

For endpoints that rarely change:

```
Rule: Cache Pricing Endpoint
When incoming requests match:
  - Path: /api/v1/subscription/pricing
Then:
  - Cache eligible resources: Cache all
  - Edge TTL: 1 hour
```

---

## 8. Security Headers (Redundant with App)

Cloudflare can add security headers at the edge, but EchoBrief already sets these in `src/server/api/middleware/security-headers.ts`.

If you want Cloudflare to add them as a backup:

1. Navigate to **Rules** → **Transform Rules**
2. Create **HTTP Response Header Modification**
3. Add headers:
   - `X-Frame-Options: DENY`
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin`

**Note:** Not strictly necessary since the app already sets these.

---

## 9. Monitoring & Alerts

### Analytics

1. Navigate to **Analytics & Logs** → **Security Events**
2. Monitor:
   - Firewall rule triggers
   - Bot challenges
   - Rate limit blocks
   - WAF blocks

### Email Alerts

1. Navigate to **Notifications**
2. Enable alerts for:
   - DDoS attacks
   - High rate limit triggers
   - WAF rule updates
   - SSL certificate expiry

---

## 10. Testing & Verification

### Test Rate Limiting

```bash
# Test general rate limit (should trigger after 1000 requests)
for i in {1..1001}; do
  curl -I https://echobrief.ai
done
# Should see 429 status after 1000 requests

# Test API rate limit (should trigger after 100 requests/min)
for i in {1..101}; do
  curl -H "Authorization: Bearer <token>" \
       https://api.echobrief.ai/api/v1/meetings
done
```

### Test DDoS Protection

**DO NOT** run actual DDoS attacks. Use Cloudflare's test mode:

1. Navigate to **Security** → **DDoS**
2. Click "Test DDoS Protection"
3. Cloudflare will simulate an attack and show mitigation

### Test WAF

```bash
# Should be blocked by WAF (SQL injection pattern)
curl "https://echobrief.ai/api/v1/meetings?id=1' OR '1'='1"
# Expected: 403 Forbidden

# Should be blocked by WAF (XSS pattern)
curl "https://echobrief.ai/api/v1/meetings?title=<script>alert(1)</script>"
# Expected: 403 Forbidden
```

---

## 11. Cost Considerations

| Plan | Price | Features |
|------|-------|----------|
| **Free** | $0/month | Basic DDoS, Bot Fight Mode, 100K requests/month rate limiting |
| **Pro** | $20/month | Advanced DDoS, Super Bot Fight Mode, 10M requests/month rate limiting |
| **Business** | $200/month | 1 Gbps DDoS, Custom WAF rules, Guaranteed uptime SLA |

**Recommendation:** Start with Free, upgrade to Pro if you see high bot traffic or need more rate limit capacity.

---

## 12. Maintenance Checklist

**Monthly:**
- [ ] Review Security Events analytics
- [ ] Check for false positives in WAF blocks
- [ ] Verify SSL certificate auto-renewal
- [ ] Review rate limit trigger counts

**Quarterly:**
- [ ] Update WAF sensitivity if needed
- [ ] Review and adjust rate limit thresholds
- [ ] Test failover (pause Cloudflare, verify Railway direct access)
- [ ] Review bot challenge success rates

**Annual:**
- [ ] Review Cloudflare plan (upgrade if needed)
- [ ] Audit firewall rules (remove unused)
- [ ] Update geographic restrictions if business changes

---

## 13. Troubleshooting

### Issue: 522 Error (Connection Timed Out)

**Cause:** Cloudflare can't reach Railway.

**Fix:**
1. Check Railway deployment is running
2. Verify DNS A/CNAME record points to correct Railway domain
3. Check Railway logs for errors

---

### Issue: 525 Error (SSL Handshake Failed)

**Cause:** Railway SSL certificate invalid or encryption mode mismatch.

**Fix:**
1. Set SSL/TLS mode to "Full (strict)"
2. Verify Railway has valid SSL certificate
3. Check Railway custom domain configuration

---

### Issue: Too Many False Positives in WAF

**Cause:** WAF sensitivity too high for your traffic patterns.

**Fix:**
1. Review blocked requests in Security Events
2. Create exception rules for legitimate traffic
3. Lower OWASP paranoia level from PL2 to PL1

---

### Issue: Legitimate Users Getting Blocked

**Cause:** Rate limits too aggressive.

**Fix:**
1. Identify user IP from Security Events
2. Add IP to allowlist (IP Access Rules)
3. Adjust rate limit thresholds upward

---

## 14. Emergency Procedures

### Disable Cloudflare Protection (If Needed)

**Scenario:** False positives blocking all traffic, need to bypass immediately.

**Steps:**
1. Navigate to **DNS**
2. Click on proxied record (orange cloud)
3. Toggle to "DNS only" (grey cloud)
4. Wait 5 minutes for TTL expiration
5. Traffic now bypasses Cloudflare

**IMPORTANT:** Only use in emergencies. You lose all protection.

---

### Allow IP Temporarily

**Scenario:** Specific IP blocked but needs immediate access.

**Steps:**
1. Navigate to **Security** → **WAF** → **Tools**
2. Click "IP Access Rules"
3. Add rule:
   - IP: `<blocked IP>`
   - Action: Allow
   - Note: "Temporary - remove after issue resolved"
4. Immediate effect (no wait time)

---

## Summary

Cloudflare provides multiple layers of protection:

1. **Network Layer:** Automatic DDoS mitigation
2. **Application Layer:** WAF + Bot Management
3. **Rate Limiting:** Edge-level throttling before hitting Railway
4. **Caching:** Reduced origin load
5. **SSL/TLS:** Certificate management + HSTS

**Security Stack:**
```
User Request
  ↓
Cloudflare Edge (DDoS + WAF + Rate Limit + Bot Detection)
  ↓
Railway (App-level security headers + rate limits)
  ↓
Application (Input sanitization + auth + quota checks)
```

**Estimated Setup Time:** 30-60 minutes  
**Ongoing Maintenance:** 10 minutes/month

---

_Document Version: 1.0_  
_Last Updated: 2026-05-20_  
_Author: Cortex Code_
