## 현재 `main` 기준 재검토 결론

변경은 꽤 많이 들어갔습니다. 특히 **patch 엔진**, **non-isolated contract revision loop**, **write/edit scope guard 시도**, **verifier backend 확장**은 명확히 보입니다.

다만 내가 이전에 P0/P1로 봤던 핵심 문제 중 상당수는 **아직 코드 레벨에서 닫히지 않았습니다.**
가장 중요한 세 가지는 그대로입니다.

1. **plan mode에서 만든 `effectiveAgent`가 실제 subagent runtime에 전달되지 않음**
2. **`apply_patch`가 contract / goal scope guard를 여전히 우회 가능**
3. **isolated task가 contract verifier loop 없이 merge/capture 경로로 감**

검토는 GitHub `steve-8000/amaze`의 현재 `main` 코드 기준 정적 리뷰입니다. 로컬 테스트 실행은 하지 않았습니다.

---

# 1. 이전 지적 대비 상태표

| 항목                                         | 현재 상태 | 판단                   |
| ------------------------------------------ | ----: | -------------------- |
| non-isolated contract revision loop        | 일부 반영 | ✅ 개선                 |
| patch engine robustness / post-write check |    반영 | ✅ 개선                 |
| `write` tool contract guard                | 부분 반영 | ⚠️ raw path 기준이라 불완전 |
| plan mode `effectiveAgent` 적용              |   미반영 | ❌ P0                 |
| `apply_patch` scope guard                  |   미반영 | ❌ P0                 |
| rename destination scope guard             |   미반영 | ❌ P0/P1              |
| isolated task verifier loop                |   미반영 | ❌ P0/P1              |
| `uncertain` verifier blocking policy       |   미반영 | ❌ P1                 |
| yield schema bypass 기본 차단                  |   미반영 | ❌ P1                 |
| verifier shell execution policy            |   미반영 | ❌ P1                 |
| `exec` alias capability split              |   미반영 | ❌ P1                 |

---

# 2. 좋아진 부분

## 2.1 `executeContractedTask()` seam은 잘 들어갔음

`task-revision-loop.ts`가 생겼고, `runRevisionLoop()`를 감싸서 `runOnce → verify → retry` 구조로 분리했습니다. 이건 좋은 방향입니다. task executor와 verifier retry를 분리해서 테스트하기 쉬운 seam이 생겼습니다. 

non-isolated 경로에서는 `stampedContract`가 있으면 `executeContractedTask()`로 감싸고, 실패 기준을 retry assignment에 넣는 구조가 들어가 있습니다. 이건 이전보다 명확히 좋아졌습니다. 

## 2.2 patch 엔진은 꽤 개선됨

`patch.ts`는 단순 문자열 치환보다 훨씬 강해졌습니다. context matching, ambiguous match rejection, fuzzy fallback, hierarchical context, line hint 처리 등이 꽤 촘촘합니다. 특히 `executePatchSingle()`에서 update 전 content를 읽고, write 후 실제 disk content가 바뀌었는지 검증하는 방어가 들어간 건 실전적으로 좋습니다.  

## 2.3 `write`에는 contract / goal scope guard가 추가됨

`WriteTool.execute()`는 mutation 전에 `enforceContractScope()`를 먼저 부르고, contract가 없을 때 goal-level `scopeGuard`도 확인합니다. 이 자체는 맞는 방향입니다. 

다만 아래에서 설명하듯, 지금은 raw path 기준이라 `conflict://`, archive/sqlite pseudo path, symlink, absolute/relative normalization 문제는 남아 있습니다.

## 2.4 verifier backend는 확장됨

`AcceptanceVerifier`에 `command-output`, `lsp-clean`, `llm-judged`, `manual` 등이 들어갔고, `VerifierResultCache`도 추가됐습니다. 설계 seam 자체는 좋아졌습니다.  

---

# 3. P0: plan mode `effectiveAgent`가 아직 실제 실행에 안 들어감

코드는 plan mode일 때 `effectiveAgent`를 만듭니다. 여기서 system prompt에 plan-mode prompt를 붙이고, tools를 `["read", "search", "find", "lsp", "web_search"]`로 제한하고, `spawns`를 제거합니다. 즉 의도는 명확합니다. 

문제는 non-isolated `baseSubprocessOptions`에서 여전히 `agent`를 넘긴다는 점입니다.

```ts
const baseSubprocessOptions = {
  cwd: this.session.cwd,
  agent,
  contract: stampedContract,
  ...
};
```

isolated branch도 마찬가지로 `runSubprocess({ ..., agent, ... })`를 직접 넘깁니다. 

## 영향

plan mode에서 subagent에게 readonly 권한만 줬다고 생각하지만, 실제 `runSubprocess()`는 `agent.tools`, `agent.spawns`, `agent.systemPrompt`를 사용합니다. executor 쪽에서 tool list, spawn env, system prompt를 모두 `agent`에서 읽습니다.  

즉, plan mode 제한은 **modelOverride / outputSchema 계산에는 반영되지만, 실제 tool surface / spawns / system prompt에는 반영되지 않습니다.**

## 바로 수정

```ts
const baseSubprocessOptions = {
  cwd: this.session.cwd,
  agent: effectiveAgent,
  contract: stampedContract,
  ...
};
```

isolated branch도:

```ts
const result = await runSubprocess({
  cwd: this.session.cwd,
  worktree: isolationDir,
  agent: effectiveAgent,
  ...
});
```

그리고 반드시 테스트 추가:

```ts
it("uses effectiveAgent in plan mode", async () => {
  // original agent has write/bash/task/spawns
  // plan mode enabled
  // assert subprocess session has only read/search/find/lsp/web_search
  // assert spawnsEnv === ""
  // assert system prompt contains planModeSubagentPrompt
});
```

---

# 4. P0: `apply_patch` scope guard가 여전히 우회됨

`EditTool.execute()`에 scope guard가 추가됐습니다. 하지만 이 guard는 `(params as { path?: string }).path`만 봅니다. 주석은 “모든 edit mode가 path를 가진다”고 되어 있는데, 실제로는 아닙니다. 

`apply_patch` schema는 `{ input: string }` 하나뿐입니다. 파일 path는 patch envelope 내부에 들어 있고, `expandApplyPatchToEntries()`가 나중에 `h.path`, `h.rename`을 뽑습니다. 

현재 `apply_patch` mode는 entries를 만든 뒤 바로 `executePatchSingle()`로 넘깁니다. 이 구간에 `enforceContractScope()`나 `enforceGoalScope()`가 없습니다. 

그리고 `executePatchSingle()` 내부에서도 contract / goal scope guard는 없습니다. plan mode write guard만 호출합니다. 

## 영향

subagent contract가 다음처럼 되어 있어도:

```json
{
  "scope": {
    "include": ["src/**"],
    "exclude": []
  }
}
```

`apply_patch` envelope 안에 `README.md`, `.github/workflows/x.yml`, `packages/other/**` 같은 path를 넣으면 top-level guard가 path를 못 보고 지나갈 수 있습니다.

## 바로 수정

`apply_patch` branch에서 entries를 expand한 직후 guard를 걸어야 합니다.

```ts
const entries = expandApplyPatchToEntries(params as ApplyPatchParams);

for (const entry of entries) {
  enforceMutationScope(tool.session, entry.path, {
    op: entry.op ?? "update",
    source: "edit.apply_patch",
  });

  if (entry.rename) {
    enforceMutationScope(tool.session, entry.rename, {
      op: "rename-destination",
      source: "edit.apply_patch.rename",
    });
  }
}
```

`patch` mode도 `rename` destination을 검사해야 합니다. 현재 top-level guard는 source `path`만 보고, `rename` destination은 contract scope 기준으로 검사하지 않습니다.  

---

# 5. P0/P1: isolated task는 아직 verifier loop를 안 탐

non-isolated path에서는 `stampedContract`가 있으면 `executeContractedTask()`로 들어갑니다. 그런데 isolated branch는 여전히 직접 `runSubprocess()`를 호출하고, 성공하면 branch commit 또는 patch capture로 넘어갑니다. 

또한 isolated branch는 `contract: task.contract`를 넘깁니다. non-isolated처럼 `stampContractRevision()`으로 parent goal revision을 찍은 contract를 쓰지 않습니다. 

## 영향

isolated mode에서 contract의 의미가 약합니다.

* contract block은 subagent prompt/tool session에 들어갈 수 있음
* 하지만 parent-side verifier / revision loop는 merge 전에 실행되지 않음
* `exitCode === 0`이면 branch/patch capture로 넘어감
* success criteria fail이어도 merge/capture를 막지 못할 가능성이 큼

## 바로 수정

isolated branch도 `executeContractedTask()`로 감싸야 합니다. 핵심은 `cwd`와 changedFiles 기준을 `isolationDir`로 맞추는 것입니다.

```ts
const parentGoalRev = this.session.getGoalModeState?.()?.goal?.contractRevision;
const stampedContract = task.contract
  ? stampContractRevision(task.contract, parentGoalRev)
  : undefined;

if (stampedContract) {
  const cwdBefore = new Set(await snapshotGitChangedFiles(isolationDir));

  const outcome = await executeContractedTask({
    contract: stampedContract,
    baseAssignment: task.assignment.trim(),
    runOnce: async ({ composedAssignment }) => {
      const result = await runSubprocess({
        cwd: this.session.cwd,
        worktree: isolationDir,
        agent: effectiveAgent,
        task: renderSubagentUserPrompt(composedAssignment, simpleMode),
        assignment: composedAssignment,
        contract: stampedContract,
        ...
      });

      const cwdAfter = await snapshotGitChangedFiles(isolationDir);
      const changedFiles = cwdAfter.filter(p => !cwdBefore.has(p));

      return {
        output: result.output ?? "",
        exitCode: result.exitCode ?? 0,
        aborted: result.aborted ?? false,
        changedFiles,
        cwd: isolationDir,
      };
    },
  });

  if (outcome.finalVerdict.verdict !== "pass") {
    return { ...lastResult, exitCode: 1, error: "Contract verifier failed" };
  }
}
```

그 다음에만 branch commit / patch capture를 해야 합니다.

---

# 6. P1: `uncertain`이 여전히 pass 처리됨

`contract.ts` 주석과 코드가 명확합니다. `runRevisionLoop()`는 verdict가 `"pass"`면 종료합니다. 그리고 문서 주석상 `"pass" 또는 "uncertain-only"`는 retry 없이 통과한다고 되어 있습니다. `verifySubagentCompletion()`도 `AcceptanceVerifier`에 `{ cwd, changedFiles }`만 넘깁니다. LSP provider나 LLM judge runner는 없습니다. 

`verifier.ts`에서도 `uncertain`은 completion을 block하지 않는다고 명시되어 있고, `summarize()`는 `failedCount > 0`일 때만 `"fail"`, 그 외에는 `"pass"`를 반환합니다.  

## 영향

다음 criteria는 실제 provider가 없으면 `uncertain`이 됩니다.

* `lsp-clean`
* `llm-judged`
* `manual`
* changedFiles가 비어 있는 `scope-include`

그런데 `uncertain`만 있으면 전체 verdict는 pass입니다. contract가 delegation boundary라면 이건 너무 약합니다.

## 수정 방향

`AcceptanceCriterion`에 blocking policy를 추가하는 게 가장 깔끔합니다.

```ts
export type BlockingPolicy = "fail-only" | "uncertain-blocks";

export interface AcceptanceCriterion {
  id: string;
  description: string;
  check: CriterionKind;
  blocking?: BlockingPolicy;
}
```

추천 기본값:

| criterion        | 기본값                     |
| ---------------- | ----------------------- |
| `scope-include`  | `uncertain-blocks`      |
| `scope-exclude`  | `fail-only`             |
| `file-exists`    | `fail-only`             |
| `command-exit`   | `fail-only`             |
| `command-output` | `fail-only`             |
| `lsp-clean`      | `uncertain-blocks`      |
| `llm-judged`     | `uncertain-blocks`      |
| `manual`         | `fail-only`, audit-only |

그리고 `summarize()`를 context-aware로 바꾸세요.

```ts
export function summarize(
  results: CriterionResult[],
  criteria: AcceptanceCriterion[],
  mode: "audit" | "contract" = "audit",
): VerificationVerdict {
  const criterionById = new Map(criteria.map(c => [c.id, c]));

  const failed = results.filter(r => r.status === "fail");
  const blockingUncertain =
    mode === "contract"
      ? results.filter(r => {
          if (r.status !== "uncertain") return false;
          const policy = criterionById.get(r.id)?.blocking ?? defaultBlockingPolicy(r);
          return policy === "uncertain-blocks";
        })
      : [];

  return {
    verdict: failed.length > 0 || blockingUncertain.length > 0 ? "fail" : "pass",
    ...
  };
}
```

---

# 7. P1: scope check가 아직 canonical path 기준이 아님

`checkScope()`는 `filePath.replace(/\\/g, "/")`만 하고 `Glob`으로 매칭합니다. cwd-relative canonical path로 변환하지 않습니다. 

`write`에서도 guard는 path resolution 전에 raw `path`에 대해 실행됩니다. 그 다음에 internal URL, `conflict://`, archive/sqlite path, plan path resolution 등이 수행됩니다. 

## 영향

다음 케이스에서 scope enforcement가 실제 mutation target과 어긋날 수 있습니다.

| 케이스                        | 문제                                      |
| -------------------------- | --------------------------------------- |
| absolute path              | glob이 cwd-relative 기준이면 mismatch        |
| `../` path                 | raw string만 normalize하면 cwd 밖 접근 판단이 약함 |
| symlink                    | scope 안 path가 실제로는 scope 밖 target일 수 있음 |
| `conflict://N`             | raw URI와 실제 backing file path가 다름       |
| archive/sqlite pseudo path | raw path와 backing file path가 다름         |
| rename destination         | destination scope가 별도로 검증되지 않음          |

## 수정 방향

공통 mutation guard를 새로 만드는 게 맞습니다.

```ts
type MutationTarget = {
  raw: string;
  absolutePath: string;
  relativeToCwd: string;
  scheme?: string;
};

async function resolveMutationTarget(
  session: ToolSession,
  rawPath: string,
): Promise<MutationTarget>;

async function enforceMutationScope(
  session: ToolSession,
  rawPath: string,
  options: {
    op: "create" | "update" | "delete" | "rename-source" | "rename-destination";
    source: string;
  },
): Promise<void>;
```

규칙은 이걸 추천합니다.

1. raw path를 실제 backing file absolute path로 resolve
2. 가능하면 `realpath` 적용
3. cwd 밖이면 기본 fail
4. cwd-relative canonical path에만 glob 적용
5. raw path는 error message에만 사용

---

# 8. P1: changedFiles attribution은 아직 set-diff뿐임

non-isolated contracted path에서 `changedFiles`는 여전히:

```ts
const changedFiles = cwdAfter.filter(p => !cwdBefore.has(p));
```

입니다. 주석도 pre-existing dirty files를 제외한다고 되어 있습니다. 

`snapshotGitChangedFiles()` 자체도 `git status --porcelain=v1 -z` 기반이고, git 실패 또는 non-repo에서는 empty list를 반환합니다. 

## 현재 상태 평가

이전 코드가 pre-existing dirty files를 전부 subagent 변경으로 오염시키는 문제가 있었다면, 지금 set-diff는 그 오염은 줄입니다. 하지만 반대 문제가 남습니다.

이미 dirty였던 파일을 subagent가 추가로 수정하면, 그 파일은 `cwdBefore`에도 있고 `cwdAfter`에도 있으므로 `changedFiles`에서 빠집니다.

## 영향

`scope-include`가 바뀐 파일을 못 보고 `uncertain`으로 떨어질 수 있습니다. 그런데 현재 `uncertain`은 pass입니다. 즉 이 문제가 verifier pass-through로 이어질 수 있습니다.

## 수정

dirty file에 대해서는 mtime 또는 content hash snapshot을 찍으세요.

```ts
const before = await snapshotDirtyFilesWithHash(cwd);

await runSubprocess(...);

const after = await snapshotDirtyFilesWithHash(cwd);

const changedFiles = diffDirtySnapshots(before, after);
```

최소 구현은 dirty file만 hash하면 됩니다. 전체 repo hash는 필요 없습니다.

---

# 9. P1: `yield` schema validation bypass가 그대로 있음

`YieldTool`은 schema validation 실패 시 첫 번째 실패에는 throw하지만, 두 번째 실패부터는 `schemaValidationOverridden = true`로 받아들입니다. 

## 영향

subagent output schema가 contract의 핵심이면, 이건 contract를 약화시킵니다. 모델이 두 번 틀리면 성공 처리됩니다.

## 수정

기본값은 bypass off로 두는 게 맞습니다.

```ts
const allowSchemaBypass =
  session.settings.get("task.yield.allowSchemaBypass") === true;

if (!parsed.success) {
  this.#schemaValidationFailures++;

  if (!allowSchemaBypass) {
    throw new Error(`Output does not match schema: ${formatJsonSchemaIssues(parsed.issues)}`);
  }

  if (this.#schemaValidationFailures <= maxBypassRetries) {
    throw new Error(...);
  }

  schemaValidationOverridden = true;
}
```

권장 설정:

```json
{
  "task.yield.allowSchemaBypass": false
}
```

---

# 10. P1: verifier command criteria는 여전히 `sh -c`

`command-exit`과 `command-output` 모두 `Bun.spawn(["sh", "-c", command])`입니다. 

## 영향

criteria가 100% trusted user-authored라면 괜찮습니다. 하지만 agent가 criteria를 생성하거나 수정할 수 있으면 verifier가 shell execution surface가 됩니다.

## 수정

argv mode를 추가하고, shell mode는 명시 opt-in으로 두세요.

```ts
type CommandCheck =
  | { type: "command-exit"; argv: string[]; expected: number; cwd?: string }
  | { type: "command-exit"; command: string; expected: number; shell: true; cwd?: string };
```

정책:

```json
{
  "verifier.allowShellCriteria": false
}
```

---

# 11. P1: `exec` alias가 아직 `eval` + `bash`로 확장됨

`runSubprocess()`는 `agent.tools`에 `"exec"`가 있으면 `"eval"`을 추가하고, 항상 `"bash"`도 추가합니다. 

## 영향

agent frontmatter 작성자는 `exec`를 “실행 가능” 정도로 생각할 수 있는데, 실제로는 shell 권한이 생깁니다. 권한 모델에서 alias가 capability를 넓히는 건 위험합니다.

## 수정

`exec` alias를 제거하거나 capability를 쪼개세요.

```yaml
tools:
  - eval
  - bash
```

또는:

```yaml
tools:
  - exec:python
  - exec:js
  - exec:shell
```

`shell`은 별도 approval/policy를 타게 하는 게 맞습니다.

---

# 12. 내가 제안하는 다음 패치 순서

## 1순위: 실제 권한 경계 닫기

이 네 개부터 하세요.

```ts
// task/index.ts
agent: effectiveAgent
```

* non-isolated `baseSubprocessOptions`
* isolated `runSubprocess`
* isolated contract도 `stampContractRevision`
* isolated contract도 `executeContractedTask`

## 2순위: mutation guard 통합

`write`, `edit.patch`, `edit.apply_patch`, `rename destination`, `conflict://`, archive/sqlite write가 모두 같은 guard를 통과해야 합니다.

```ts
await enforceMutationScope(session, targetPath, {
  op,
  source: "edit.apply_patch",
});
```

## 3순위: verifier semantics 강화

contract mode에서는 `uncertain`을 그냥 pass하지 마세요.

```ts
summarize(results, criteria, "contract")
```

## 4순위: structured output hardening

`yield` schema bypass를 기본 off로 전환하세요.

## 5순위: shell surface 줄이기

`command-*` criteria는 argv mode를 기본으로 하고, `sh -c`는 policy gate 뒤로 보내세요.

---

# 13. 추가해야 할 회귀 테스트

| 테스트                                        | 기대                                               |
| ------------------------------------------ | ------------------------------------------------ |
| `planModePassesEffectiveAgentToSubprocess` | plan mode subagent에서 write/bash/task/spawns 제거   |
| `isolatedPlanModeUsesEffectiveAgent`       | isolated에서도 동일하게 readonly                        |
| `applyPatchRejectsOutOfScopePath`          | apply_patch envelope 내부 path도 scope 검사           |
| `patchRejectsOutOfScopeRenameDestination`  | rename destination도 scope 검사                     |
| `writeScopeUsesCanonicalTarget`            | absolute/`../`/symlink 우회 차단                     |
| `conflictUriScopeUsesBackingFile`          | `conflict://N`이 실제 파일 기준으로 검사                    |
| `isolatedContractVerifierBlocksMerge`      | isolated task verifier fail 시 merge/capture 금지   |
| `contractUncertainBlocksWhenStrict`        | strict contract에서 LSP/LLM missing provider는 fail |
| `yieldInvalidSchemaDoesNotBypassByDefault` | 두 번째 invalid yield도 성공 처리 안 됨                    |
| `commandCriteriaShellRequiresPolicy`       | shell criteria는 policy off에서 reject              |
| `execDoesNotImplicitlyGrantBash`           | exec alias가 bash를 몰래 추가하지 않음                     |
| `dirtyFileModifiedDuringTaskIsAttributed`  | 기존 dirty file 추가 변경도 changedFiles에 포함            |

---

## 최종 판단

이번 변경은 **기능/엔진 쪽으로는 확실히 진전**이 있습니다. 특히 patch engine과 non-isolated revision loop는 좋아졌습니다.

하지만 “agent runtime 신뢰성” 관점에서는 아직 핵심 경계가 열려 있습니다.

가장 먼저 고칠 것은 이 세 개입니다.

1. **`agent` → `effectiveAgent`로 실제 subprocess option 교체**
2. **`apply_patch` / rename destination까지 mutation scope guard 적용**
3. **isolated task도 verifier 통과 전에는 merge/capture 금지**

이 세 개를 닫으면 코드베이스의 안정성이 크게 올라갑니다. 지금 상태는 “기능은 강해졌지만, 권한·검증 경계는 아직 의도만큼 닫히지 않은 상태”입니다.
