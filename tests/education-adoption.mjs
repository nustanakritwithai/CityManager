import assert from 'node:assert/strict';
import { createEducation } from '../src/education.ts';

/** The loaded city must match the save, plus the empty education record when the save had none. */
export function assertAdoptedCity(actual, expected, message = 'Loaded save') {
  const { education, ...actualCity } = actual;
  const { education: savedEducation, ...savedCity } = expected;
  assert.deepEqual(actualCity, savedCity, `${message}: money, population, goods and the rest of the city stay unchanged`);
  if (savedEducation) assert.deepEqual(education, savedEducation, `${message}: an education record already in the save is kept`);
  else assert.deepEqual(education, createEducation('migrated-absent'), `${message}: only an empty education record is added`);
}

export async function assertOriginalSave(evaluate, raw, key = 'citymanager.save.v7') {
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(key)})`), raw, 'Loading does not rewrite the original save bytes');
}
