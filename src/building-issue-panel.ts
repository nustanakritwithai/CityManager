import { buildingIssues, type Issue } from './building-issues.ts';
import type { City } from './sim.ts';
import { iconElement } from './ui-icons.ts';
import { ISSUE_ICONS } from './building-issues.ts';
let rendered: Issue | undefined, previousHost: HTMLElement | null = null;
/** Adds explanations inside the SAME place inspector, never an extra inspector or an action. */
export function renderBuildingIssues(city: City, cell: number | null, host: HTMLElement): void {
  const issue = cell === null ? undefined : buildingIssues(city).find(issue => issue.cell === cell);
  host.hidden = !issue;
  if (rendered === issue && previousHost === host) return;
  rendered = issue; previousHost = host; host.replaceChildren();
  if (!issue) return;
  host.className = 'bc-issue-list'; host.dataset.cell = String(issue.cell);
  const heading = document.createElement('h3'); heading.textContent = 'สถานะและสิ่งที่ยังขาด'; host.append(heading);
  for (const fact of issue.details) {
    const row = document.createElement('div'); row.className = `bc-issue-row ${fact.tone}`; row.dataset.issue = fact.kind;
    if (fact.current !== undefined) row.dataset.current = String(fact.current);
    if (fact.required !== undefined) row.dataset.required = String(fact.required);
    const copy = document.createElement('div'), label = document.createElement('strong'), detail = document.createElement('p');
    label.textContent = fact.text; detail.textContent = fact.detail; copy.append(label, detail);
    row.append(iconElement(ISSUE_ICONS[fact.kind]), copy); host.append(row);
  }
}
