import { OwnFleetAdapter } from './ownFleet'
import { TCatAdapter } from './tcat'
import { XinzhuAdapter } from './xinzhu'
import { SFExpressAdapter } from './sfexpress'
import { CVSAdapter } from './cvs'

const ADAPTERS = {
  own_fleet: OwnFleetAdapter,
  tcat: TCatAdapter,
  xinzhu: XinzhuAdapter,
  sfexpress: SFExpressAdapter,
  cvs: CVSAdapter,
}

export function getAdapter(adapterType, credentials = {}) {
  const Adapter = ADAPTERS[adapterType]
  if (!Adapter) return null
  return new Adapter(credentials)
}

export { OwnFleetAdapter, TCatAdapter, XinzhuAdapter, SFExpressAdapter, CVSAdapter }
