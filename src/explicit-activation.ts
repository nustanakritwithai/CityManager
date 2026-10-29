/** A newly opened panel must not consume the compatibility click from its opening map tap. */
export function onExplicitActivation(button: HTMLButtonElement, activate: () => void): void {
  let pointerStartedHere = false;
  button.addEventListener('pointerdown', event => { pointerStartedHere = event.button === 0; });
  button.addEventListener('pointercancel', () => { pointerStartedHere = false; });
  button.addEventListener('click', event => {
    // Keyboard and assistive activation use detail=0 and remain available.
    const allowed = event.detail === 0 || pointerStartedHere;
    pointerStartedHere = false;
    if (!allowed) { event.preventDefault(); event.stopPropagation(); return; }
    activate();
  });
}
