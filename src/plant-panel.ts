import { plantUpgradeStatus, type City } from './sim.ts';
import { PLANT_LABELS, type Plant, type PlantLevel } from './utilities.ts';
const money = (value: number) => `฿${(value / 100).toLocaleString('th-TH')}`;

/** Persistent controls preserve focus while the simulation refreshes the inspector. */
export function installPlantPanel(host: HTMLElement, upgrade: (city: City, id: number, level: PlantLevel) => void) {
  host.id = 'plant-actions'; host.hidden = true;
  const title = document.createElement('h3'), quote = document.createElement('p'), reserve = document.createElement('p');
  const button = document.createElement('button'), feedback = document.createElement('p');
  quote.id = 'plant-upgrade-quote'; reserve.id = 'plant-upgrade-reserve';
  button.type = 'button'; button.id = 'upgrade-plant';
  feedback.id = 'plant-feedback'; feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
  button.setAttribute('aria-describedby', `${quote.id} ${reserve.id} ${feedback.id}`);
  let selectedCity: City | null = null, selectedId: number | null = null, displayedLevel: PlantLevel = 1;
  let readyAt = 0;
  button.addEventListener('keydown', event => { if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault(); });
  button.addEventListener('click', event => {
    if (button.disabled || event.detail > 1 || Date.now() < readyAt || !selectedCity || selectedId === null) return;
    readyAt = Date.now() + 600; button.disabled = true;
    setTimeout(() => { if (selectedCity) panel.update(selectedCity, selectedCity.plants.find(p => p.id === selectedId)); }, 610);
    upgrade(selectedCity, selectedId, displayedLevel);
  });
  host.append(title, quote, reserve, button, feedback);
  const panel = {
    update(city: City, plant: Plant | undefined) {
      host.hidden = !plant;
      if (selectedCity !== city || selectedId !== (plant?.id ?? null)) feedback.textContent = '';
      selectedCity = city; selectedId = plant?.id ?? null;
      if (!plant) { button.disabled = true; return; }
      const data = plantUpgradeStatus(city, plant.id)!; displayedLevel = data.level;
      title.textContent = `${PLANT_LABELS[plant.kind]} · ระดับ ${data.level}/3`;
      reserve.textContent = `เงินคลังใช้จ่ายได้ ${money(data.available)} · หักเงินที่กันไว้แล้ว`;
      button.disabled = !!data.reasons.length || Date.now() < readyAt;
      if (!data.next || !data.nextLevel) {
        quote.textContent = `กำลังผลิต ${data.current.capacity} หน่วย · ค่าบำรุง ${money(data.current.upkeep)}/เดือน`;
        button.textContent = 'ถึงระดับสูงสุดแล้ว';
      } else {
        quote.textContent = `กำลังผลิต ${data.current.capacity} → ${data.next.capacity} หน่วย · ค่าบำรุง ${money(data.current.upkeep)} → ${money(data.next.upkeep)}/เดือน · ใช้พื้นที่เดิม`;
        button.textContent = `อัปเกรดระดับ ${data.nextLevel} · ${money(data.next.upgradeCost)}`;
      }
      button.title = data.reasons.join(' · ');
      reserve.textContent += data.reasons.length ? ` · ${data.reasons.join(' · ')}` : '';
    },
    showResult(result: { message: string }) { feedback.textContent = result.message; },
  };
  return panel;
}
