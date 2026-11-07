import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../.github/workflows/traffic-harness-compile.yml',import.meta.url),'utf8');
test('compiler workflow cannot launch calibration or paired trials',()=>{
 assert.match(workflow,/branches: \['diagnostic\/housing-harness-compile'\]/);
 assert.match(workflow,/contents: read/);assert.match(workflow,/persist-credentials: false/);
 assert.ok(!workflow.includes('workflow_dispatch'));assert.ok(!workflow.includes('pull_request:'));
 assert.ok(!workflow.includes('scripts/traffic-harness-calibration.mjs'));assert.ok(!workflow.includes('scripts/traffic-game-paired-diagnostic.mjs'));
 assert.match(workflow,/diagnostic-owned-process.ps1 -CompileOnly/);
 assert.ok(!workflow.includes('-Executable'));assert.ok(!workflow.includes('-OwnedChildSelfTest'));
 assert.match(workflow,/shell: powershell/);assert.match(workflow,/exit \$LASTEXITCODE/);
 assert.ok(workflow.indexOf('name: Preserve compile-only plan')<workflow.indexOf('name: Verify compiler-only boundary'));
 assert.match(workflow,/if: always\(\)/);assert.ok(workflow.includes('42380138115'));
});

test('native diagnostic fixtures precede compilation with retained output',()=>{
 assert.ok(workflow.includes('scripts/diagnostic-compiler-diagnostics.ps1'));
 assert.ok(workflow.includes('tests/diagnostic-compiler-diagnostics.fixture.ps1'));
 assert.ok(workflow.indexOf('-DiagnosticsFixtureOnly')<workflow.indexOf('-CompileOnly'));
 assert.ok(workflow.includes('extractor-fixtures.log'));
});
