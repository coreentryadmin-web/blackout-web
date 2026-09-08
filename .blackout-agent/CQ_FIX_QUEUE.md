# CQ Fix Queue — Cursor → Claude cross-exam closure

**Generated:** 2026-09-05T20:12:16.171Z  
**Source:** `CLAUDE_ANSWERS_TO_CQ.md` (218 answers)

## Summary

| Answer class | Count | Fix disposition |
|--------------|-------|-----------------|
| PROVEN | 87 | **CLOSED** |
| DISPROVEN | 35 | **CLOSED** |
| PARTIALLY PROVEN | 76 | 17 code-fixed · 62 live-check only · remainder CLOSED-LIVE-CHECK |
| UNKNOWN | 20 | **CLOSED-LIVE-LIMITED** |

**All 218 CQs have documented answers.** Code-fixable gaps: **17** addressed across batches #4023–#4026.

## Code-fix ledger

| CQ | Gap | Status | PR |
|----|-----|--------|-----|
| CQ-003 | JWT tier downgrade window (tier-cache + auth-access) | FIXED | #4024+#4026 |
| CQ-007 | email enumeration via isNew response | FIXED | #4023 |
| CQ-027 | Helix neutral-aggressor default filter contract | FIXED | #4026 |
| CQ-051 | vector offline audit scripts in package.json | FIXED | #4024 |
| CQ-054 | Vector spot<=0 guard + test | FIXED | #4024 |
| CQ-079 | Largo cross-tool conflict prompt + contract test | FIXED | #4026 |
| CQ-083 | FlowTapeSummary as_of freshness | FIXED | #4024 |
| CQ-085 | Largo neutral-edge mandatory prompt | FIXED | #4026 |
| CQ-095 | internals_estimated UI badge | FIXED | #4023 |
| CQ-112 | GEX heatmap cross-replica build lock | FIXED | #4026 |
| CQ-113 | JWT fast-path tier bypass (API + page gate) | FIXED | #4024+#4026 |
| CQ-114 | Whop Redis fail-open ops alert | FIXED | #4025 |
| CQ-152 | CSP baseCsp wiring CI guard | FIXED | #4026 |
| CQ-170 | Whop webhook route signature test | FIXED | #3998 |
| CQ-171 | validate:tool-agent CI wiring | FIXED | #4007 |
| CQ-173 | premium gate functional 403 test | FIXED | #4023 |
| CQ-183 | sitemap lastmod CI guard | FIXED | #3995 |

## Per-CQ ledger

| CQ | Answer | Fix status | Notes |
|----|--------|------------|-------|
| CQ-001 | PROVEN | CLOSED |  |
| CQ-002 | PROVEN | CLOSED |  |
| CQ-003 | PARTIAL | FIXED | JWT tier downgrade window (tier-cache + auth-access) |
| CQ-004 | PROVEN | CLOSED |  |
| CQ-005 | PROVEN | CLOSED |  |
| CQ-006 | PROVEN | CLOSED |  |
| CQ-007 | PROVEN | FIXED | email enumeration via isNew response |
| CQ-008 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-009 | DISPROVEN | CLOSED |  |
| CQ-010 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-011 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-012 | PROVEN | CLOSED |  |
| CQ-013 | PROVEN | CLOSED |  |
| CQ-014 | PROVEN | CLOSED |  |
| CQ-015 | DISPROVEN | CLOSED |  |
| CQ-016 | PROVEN | CLOSED |  |
| CQ-017 | PROVEN | CLOSED |  |
| CQ-018 | PROVEN | CLOSED |  |
| CQ-019 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-020 | DISPROVEN | CLOSED |  |
| CQ-021 | PROVEN | CLOSED |  |
| CQ-022 | PROVEN | CLOSED |  |
| CQ-023 | DISPROVEN | CLOSED |  |
| CQ-024 | PROVEN | CLOSED |  |
| CQ-025 | PROVEN | CLOSED |  |
| CQ-026 | PROVEN | CLOSED |  |
| CQ-027 | PARTIAL | FIXED | Helix neutral-aggressor default filter contract |
| CQ-028 | DISPROVEN | CLOSED |  |
| CQ-029 | PROVEN | CLOSED |  |
| CQ-030 | DISPROVEN | CLOSED |  |
| CQ-031 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-032 | DISPROVEN | CLOSED |  |
| CQ-033 | PROVEN | CLOSED |  |
| CQ-034 | PARTIAL | CLOSED-PRODUCT | helix conviction score — product gap (wired validator only) |
| CQ-035 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-036 | PROVEN | CLOSED |  |
| CQ-037 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-038 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-039 | PROVEN | CLOSED |  |
| CQ-040 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-041 | DISPROVEN | CLOSED |  |
| CQ-042 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-043 | PROVEN | CLOSED |  |
| CQ-044 | PROVEN | CLOSED |  |
| CQ-045 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-046 | PARTIAL | CLOSED | vector-pick-sweep overlap lock |
| CQ-047 | DISPROVEN | CLOSED |  |
| CQ-048 | PROVEN | CLOSED |  |
| CQ-049 | PROVEN | CLOSED |  |
| CQ-050 | PROVEN | CLOSED |  |
| CQ-051 | PROVEN | FIXED | vector offline audit scripts in package.json |
| CQ-052 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-053 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-054 | PARTIAL | FIXED | Vector spot<=0 guard + test |
| CQ-055 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-056 | PROVEN | CLOSED |  |
| CQ-057 | PROVEN | CLOSED |  |
| CQ-058 | PROVEN | CLOSED |  |
| CQ-059 | PROVEN | CLOSED |  |
| CQ-060 | PROVEN | CLOSED |  |
| CQ-061 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-062 | PROVEN | CLOSED |  |
| CQ-063 | PROVEN | CLOSED |  |
| CQ-064 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-065 | DISPROVEN | CLOSED |  |
| CQ-066 | PROVEN | CLOSED |  |
| CQ-067 | PROVEN | CLOSED |  |
| CQ-068 | PROVEN | CLOSED |  |
| CQ-069 | DISPROVEN | CLOSED |  |
| CQ-070 | PARTIAL | CLOSED-PRODUCT | Meridian suggestedPlay unwired by design |
| CQ-071 | PROVEN | CLOSED |  |
| CQ-072 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-073 | DISPROVEN | CLOSED |  |
| CQ-074 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-075 | PROVEN | CLOSED |  |
| CQ-076 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-077 | PROVEN | CLOSED |  |
| CQ-078 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-079 | PARTIAL | FIXED | Largo cross-tool conflict prompt + contract test |
| CQ-080 | PROVEN | CLOSED |  |
| CQ-081 | DISPROVEN | CLOSED |  |
| CQ-082 | PROVEN | CLOSED |  |
| CQ-083 | PARTIAL | FIXED | FlowTapeSummary as_of freshness |
| CQ-084 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-085 | PARTIAL | FIXED | Largo neutral-edge mandatory prompt |
| CQ-086 | PROVEN | CLOSED |  |
| CQ-087 | PROVEN | CLOSED |  |
| CQ-088 | DISPROVEN | CLOSED |  |
| CQ-089 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-090 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-091 | PROVEN | CLOSED |  |
| CQ-092 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-093 | PROVEN | CLOSED |  |
| CQ-094 | PROVEN | CLOSED |  |
| CQ-095 | PARTIAL | FIXED | internals_estimated UI badge |
| CQ-096 | DISPROVEN | CLOSED |  |
| CQ-097 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-098 | PROVEN | CLOSED |  |
| CQ-099 | PROVEN | CLOSED |  |
| CQ-100 | PROVEN | CLOSED |  |
| CQ-101 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-102 | PROVEN | CLOSED |  |
| CQ-103 | PROVEN | CLOSED |  |
| CQ-104 | PROVEN | CLOSED |  |
| CQ-105 | PROVEN | CLOSED |  |
| CQ-106 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-107 | PROVEN | CLOSED |  |
| CQ-108 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-109 | DISPROVEN | CLOSED |  |
| CQ-110 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-111 | DISPROVEN | CLOSED |  |
| CQ-112 | PARTIAL | FIXED | GEX heatmap cross-replica build lock |
| CQ-113 | PARTIAL | FIXED | JWT fast-path tier bypass (API + page gate) |
| CQ-114 | PROVEN | FIXED | Whop Redis fail-open ops alert |
| CQ-115 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-116 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-117 | PROVEN | CLOSED |  |
| CQ-118 | PROVEN | CLOSED |  |
| CQ-119 | PROVEN | CLOSED |  |
| CQ-120 | PROVEN | CLOSED |  |
| CQ-121 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-122 | PROVEN | CLOSED |  |
| CQ-123 | PROVEN | CLOSED |  |
| CQ-124 | PROVEN | CLOSED |  |
| CQ-125 | PROVEN | CLOSED |  |
| CQ-126 | PROVEN | CLOSED |  |
| CQ-127 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-128 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-129 | PROVEN | CLOSED |  |
| CQ-130 | DISPROVEN | CLOSED |  |
| CQ-131 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-132 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-133 | PROVEN | CLOSED |  |
| CQ-134 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-135 | PROVEN | CLOSED |  |
| CQ-136 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-137 | DISPROVEN | CLOSED |  |
| CQ-138 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-139 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-140 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-141 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-142 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-143 | DISPROVEN | CLOSED |  |
| CQ-144 | PROVEN | CLOSED |  |
| CQ-145 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-146 | DISPROVEN | CLOSED |  |
| CQ-147 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-148 | PROVEN | CLOSED |  |
| CQ-149 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-150 | PROVEN | CLOSED |  |
| CQ-151 | DISPROVEN | CLOSED |  |
| CQ-152 | PARTIAL | FIXED | CSP baseCsp wiring CI guard |
| CQ-153 | DISPROVEN | CLOSED |  |
| CQ-154 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-155 | PROVEN | CLOSED |  |
| CQ-156 | PROVEN | CLOSED |  |
| CQ-157 | PROVEN | CLOSED |  |
| CQ-158 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-159 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-160 | DISPROVEN | CLOSED |  |
| CQ-161 | PROVEN | CLOSED |  |
| CQ-162 | DISPROVEN | CLOSED |  |
| CQ-163 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-164 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-165 | PROVEN | CLOSED |  |
| CQ-166 | PROVEN | CLOSED |  |
| CQ-167 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-168 | PROVEN | CLOSED |  |
| CQ-169 | DISPROVEN | CLOSED |  |
| CQ-170 | PROVEN | FIXED | Whop webhook route signature test |
| CQ-171 | PARTIAL | FIXED | validate:tool-agent CI wiring |
| CQ-172 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-173 | DISPROVEN | FIXED | premium gate functional 403 test |
| CQ-174 | PROVEN | CLOSED |  |
| CQ-175 | PROVEN | CLOSED |  |
| CQ-176 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-177 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-178 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-179 | DISPROVEN | CLOSED |  |
| CQ-180 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-181 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-182 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-183 | DISPROVEN | FIXED | sitemap lastmod CI guard |
| CQ-184 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-185 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-186 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-187 | DISPROVEN | CLOSED |  |
| CQ-188 | DISPROVEN | CLOSED |  |
| CQ-189 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-190 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-191 | PROVEN | CLOSED |  |
| CQ-192 | DISPROVEN | CLOSED |  |
| CQ-193 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-194 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-195 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-196 | DISPROVEN | CLOSED |  |
| CQ-197 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-198 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-199 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-200 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-201 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-202 | PROVEN | CLOSED |  |
| CQ-203 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-204 | PROVEN | CLOSED |  |
| CQ-205 | PARTIAL | CLOSED-LIVE-CHECK |  |
| CQ-206 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-207 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-208 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-209 | PROVEN | CLOSED |  |
| CQ-210 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-211 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-212 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-213 | UNKNOWN | CLOSED-LIVE-LIMITED |  |
| CQ-214 | PROVEN | CLOSED |  |
| CQ-215 | DISPROVEN | CLOSED |  |
| CQ-216 | PROVEN | CLOSED |  |
| CQ-217 | DISPROVEN | CLOSED |  |
| CQ-218 | UNKNOWN | CLOSED-LIVE-LIMITED |  |

---

**Process:** Cursor `cursor/*` PRs → Claude GitHub Approve @ HEAD → merge (HARD MERGE GATE).
