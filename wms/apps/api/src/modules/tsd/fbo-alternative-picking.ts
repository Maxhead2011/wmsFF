export const alternativeFboPickingEnabled = () => process.env.WMS_FBO_ALTERNATIVE_PICK_ENABLED === 'true';

// FIX: prefer the physically scanned source among scoped candidates; all stock guards still run afterwards.
export function prioritizeAlternativeFboBox<T extends {code:string}>(boxes:T[], context:{sourceBoxCode?:unknown}) {
  if (!alternativeFboPickingEnabled() || typeof context.sourceBoxCode !== 'string') return boxes;
  const code=context.sourceBoxCode.trim().toUpperCase();
  if (!/^FFL[\w-]{1,96}$/.test(code)) return boxes;
  const selected=boxes.find(box=>box.code.toUpperCase()===code);
  return selected ? [selected,...boxes.filter(box=>box!==selected)] : boxes;
}
