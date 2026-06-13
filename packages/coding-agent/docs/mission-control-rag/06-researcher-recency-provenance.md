---
doc_id: mission-control-rag-06-researcher-recency-provenance
domain: mission-control-rag/researcher-recency-provenance
retrieval_tags:
  - researcher
  - recency
  - provenance
  - citations
  - external-facts
  - web-search
  - evaluations
  - governance
  - human-oversight
  - risk-management
source_evidence:
  - https://platform.openai.com/docs/guides/tools-web-search
  - https://developers.openai.com/api/reference/resources/responses/methods/create
  - https://developers.openai.com/api/docs/guides/evaluation-best-practices
  - https://reference.langchain.com/python/langgraph.prebuilt/chat_agent_executor/create_react_agent
  - https://langchain-ai.github.io/langgraph/how-tos/react-agent-from-scratch-functional/
  - https://api.github.com/repos/steve-8000/amaze/commits/main?per_page=1
  - https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ%3AL_202401689
  - https://airc.nist.gov/airmf-resources/airmf/5-sec-core/
  - https://www.nist.gov/itl/ai-risk-management-framework/nist-ai-rmf-playbook
planner_uses:
  - Decide when Researcher dispatch is mandatory before MissionPlan synthesis.
  - Preserve dated external facts, URL citations, and source inventory in planner context.
  - Require provenance-aware Builder acceptance criteria for externally grounded implementation.
---

# Researcher Recency and Provenance

Related index: [README.md](./README.md). Contract synthesis: [02-planner-contracting.md](./02-planner-contracting.md). Autonomy scheduling: [01-autonomy-objective-loop.md](./01-autonomy-objective-loop.md).

## Spec

Mission Control MUST dispatch Researcher before final planning when a mission depends on facts that may have changed outside the repository, including governance, legal, regulatory, standards, or risk-management guidance. The planner must treat Researcher output as a dated evidence layer, not as generic prose.

Researcher is mandatory for:

- current/latest/versioned API behavior;
- external documentation;
- provider/model capabilities;
- release notes, changelogs, pricing, security advisories, or ecosystem issues;
- web/X/social evidence;
- evaluation methodology or benchmark claims;
- governance, legal, regulatory, standards, or risk-management guidance;
- any plan step whose acceptance criteria depends on external source behavior.

Researcher is optional when all required facts are repository-local and stable, such as current TypeScript interfaces already present in source evidence.

## External research facts

These facts were checked on 2026-06-13 and should be refreshed by Researcher when used for implementation decisions after that date.

- OpenAI web-search docs distinguish retrieval modes and provide URL citation annotations: <https://platform.openai.com/docs/guides/tools-web-search>.
- GitHub repository baseline: on 2026-06-13, <https://api.github.com/repos/steve-8000/amaze/commits/main?per_page=1> reported `main` at `20f0ce5f1f4c8efd2f3c88b901948b6ebac9edf2` (`20f0ce5`), commit message `Restore local gbrain integration`, committed 2026-06-13T03:27:16Z.
- OpenAI Responses API can include full `web_search_call.action.sources` for source inventory: <https://developers.openai.com/api/reference/resources/responses/methods/create>.
- OpenAI eval best practices require explicit objectives, datasets, metrics, and calibrating automated evals with human feedback: <https://developers.openai.com/api/docs/guides/evaluation-best-practices>.
- LangGraph `create_react_agent` documents looped model/tool execution plus `interrupt_before`, `interrupt_after`, and `post_model_hook` guardrails: <https://reference.langchain.com/python/langgraph.prebuilt/chat_agent_executor/create_react_agent>.
- LangGraph workflow docs describe orchestrator-worker patterns with dynamic worker dispatch and shared state synthesis: <https://langchain-ai.github.io/langgraph/how-tos/react-agent-from-scratch-functional/>.
- EU AI Act Article 14 requires effective human oversight for high-risk AI systems, including safe override/stop capabilities; checked 2026-06-13 at <https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ%3AL_202401689>.
- NIST AI RMF Core uses Govern, Map, Measure, and Manage functions as a lifecycle for AI risk management and includes ongoing monitoring/review; checked 2026-06-13 at <https://airc.nist.gov/airmf-resources/airmf/5-sec-core/>.
- NIST AI RMF Playbook was updated 2026-06-10; checked 2026-06-13 at <https://www.nist.gov/itl/ai-risk-management-framework/nist-ai-rmf-playbook>.

## Provenance model

A Researcher handoff should preserve both human-readable findings and machine-checkable provenance:

- `checkedAt`: date/time the fact was checked.
- `claim`: atomic claim used by the planner.
- `confidence`: confidence in the claim after source review.
- `sources`: URL, title, retrieved timestamp, citation spans/annotations, and source inventory metadata.
- `requiresRefreshAfter`: date or condition requiring a new Researcher run.
- `plannerImpact`: which MissionPlan step or acceptance criterion depends on the claim.

The planner MUST avoid mixing repository facts and external facts without labels. Repository evidence should cite file paths. External evidence should cite URLs and checked dates.

## Researcher dispatch rules

Dispatch Researcher before MissionPlan synthesis when any of these predicates is true:

- The objective includes `latest`, `current`, `recent`, `release`, `changelog`, `docs`, `web`, `X`, `Twitter`, `pricing`, `security`, `provider`, `model`, `API`, `SDK`, or `benchmark`.
- The objective includes governance, legal, regulatory, standards, compliance, oversight, risk-management, override, stop, or human-in-the-loop claims.
- A domain doc metadata block sets Researcher mandatory.
- A planner step requires an external API shape, current provider capability, or version-specific behavior.
- An acceptance criterion would be unverifiable without a URL, source inventory, or dated external fact.
- A planner step depends on current legal, regulatory, standards, or risk governance guidance.
- Existing Researcher facts are older than the mission's freshness policy.

## Target TypeScript Sample: ResearchFinding and CitationSource

This is target/source sample code, not an existing implementation.

```ts
type ResearchConfidence = "low" | "medium" | "high";

type CitationKind = "url-citation" | "source-inventory" | "paper" | "release-note" | "issue" | "x-post";

interface CitationSource {
	kind: CitationKind;
	url: string;
	title?: string;
	publisher?: string;
	retrievedAt: string;
	quotedText?: string;
	annotation?: {
		startIndex?: number;
		endIndex?: number;
		label?: string;
	};
	webSearchActionSource?: {
		id?: string;
		type?: string;
	};
}

interface ResearchFinding {
	id: string;
	claim: string;
	checkedAt: string;
	confidence: ResearchConfidence;
	sources: CitationSource[];
	requiresRefreshAfter?: string;
	plannerImpact: Array<{
		planStepId?: string;
		acceptanceCriterionId?: string;
		reason: string;
	}>;
}

function assertFindingHasProvenance(finding: ResearchFinding): void {
	if (finding.sources.length === 0) throw new Error(`Research finding ${finding.id} has no sources`);
	for (const source of finding.sources) {
		if (!source.url || !source.retrievedAt) {
			throw new Error(`Research finding ${finding.id} has an incomplete source`);
		}
	}
}
```

## Target TypeScript Sample: planner retrieval decision

This is target/source sample code, not an existing implementation.

```ts
interface PlannerRetrievalInput {
	objective: string;
	domainDocTags: string[];
	domainRequiresResearcher: boolean;
	existingFindings: ResearchFinding[];
	nowIso: string;
}

interface PlannerRetrievalDecision {
	retrieveDocs: boolean;
	dispatchResearcher: boolean;
	reasons: string[];
}

const RECENCY_TERMS = [
	"latest",
	"current",
	"recent",
	"release",
	"changelog",
	"docs",
	"web",
	"pricing",
	"security",
	"provider",
	"model",
	"api",
	"sdk",
	"benchmark",
	"governance",
	"legal",
	"regulatory",
	"regulation",
	"standards",
	"standard",
	"compliance",
	"oversight",
	"risk",
	"risk-management",
	"override",
	"stop",
	"human-in-the-loop",
];

function decidePlannerRetrieval(input: PlannerRetrievalInput): PlannerRetrievalDecision {
	const text = `${input.objective} ${input.domainDocTags.join(" ")}`.toLowerCase();
	const reasons: string[] = [];

	if (input.domainRequiresResearcher) {
		reasons.push("domain doc requires Researcher");
	}

	if (RECENCY_TERMS.some(term => text.includes(term))) {
		reasons.push("objective or tags include recency/external terms");
	}

	for (const finding of input.existingFindings) {
		if (finding.requiresRefreshAfter && finding.requiresRefreshAfter < input.nowIso) {
			reasons.push(`finding ${finding.id} is stale`);
		}
	}

	return {
		retrieveDocs: true,
		dispatchResearcher: reasons.length > 0,
		reasons,
	};
}
```

## Mission Control acceptance criteria

- Planner dispatches Researcher before final MissionPlan synthesis for current, external, versioned, provider, web, security, pricing, benchmark, governance, legal, regulatory, standards, or risk-management facts.
- Researcher output includes dated findings, confidence, source URLs, and retrieved timestamps.
- OpenAI web-search citations and Responses API `web_search_call.action.sources` are preserved when available.
- Planner labels external research facts separately from repository source evidence.
- Builder contracts that depend on external facts include acceptance criteria requiring citation/provenance preservation.
- Automated eval plans include objectives, datasets, metrics, and a human-feedback calibration path when using external eval guidance.
- Stale findings trigger a new Researcher dispatch instead of being reused silently.
