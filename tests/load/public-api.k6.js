import { check } from "k6";
import http from "k6/http";

const publicApiUrl = __ENV.ABL_LOAD_PUBLIC_API_URL;
const coreApiUrl = __ENV.ABL_LOAD_CORE_API_URL;
if (!publicApiUrl || !coreApiUrl)
  throw new Error(
    "ABL_LOAD_PUBLIC_API_URL and ABL_LOAD_CORE_API_URL are required",
  );

export const options = {
  discardResponseBodies: true,
  scenarios: {
    spectator_cursors: {
      executor: "per-vu-iterations",
      exec: "spectatorCursor",
      vus: 10_000,
      iterations: 2,
      maxDuration: "5m",
      tags: { workload: "spectator-cursors" },
    },
    candidate_challenges: {
      executor: "shared-iterations",
      exec: "candidateChallenge",
      vus: 100,
      iterations: 2_000,
      maxDuration: "5m",
      startTime: "30s",
      tags: { workload: "candidate-challenges" },
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<750"],
    checks: ["rate>0.99"],
    dropped_iterations: ["count==0"],
  },
};

export function spectatorCursor() {
  const gameLane = __ITER % 20;
  const response = http.get(
    `${publicApiUrl}/v1/public/games/load-game-${gameLane}/cursor`,
    { tags: { name: "public-game-cursor" } },
  );
  check(response, { "cursor response is 200": ({ status }) => status === 200 });
}

export function candidateChallenge() {
  const candidateDid = `did:abl:k6-${__VU}-${__ITER}`;
  const response = http.post(
    `${coreApiUrl}/v1/candidates/challenge`,
    JSON.stringify({ candidateDid }),
    {
      headers: { "content-type": "application/json" },
      tags: { name: "candidate-challenge" },
    },
  );
  check(response, {
    "candidate challenge response is 200": ({ status }) => status === 200,
  });
}
