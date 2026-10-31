/** Project a durable application save for the market's existing core-city checks.
 * Validate the entire session first: removing an invalid rail payload must never
 * make an otherwise unsafe save eligible for receipt acknowledgement.
 */
import {deserializeParkSession} from '../park-runtime.ts';
import {serialize} from '../sim.ts';

export function durableCityProjection(raw:string|null,expectedCityId:string):string|null {
  if(raw===null)return null;
  const {city}=deserializeParkSession(raw);
  if(!city.market||city.market.cityId!==expectedCityId)throw Error('Durable city identity mismatch');
  return serialize(city);
}
