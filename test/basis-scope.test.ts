import { describe, it, expect } from 'vitest'
import { projectRegistry } from '../src/projection.js'
import contract from '../src/RESEARCH_CONTRACT.json'
describe('direct basis compact discovery', () => {
  it('preserves enforced availability when prose is removed', () => {
    const scope = contract.feature_scopes['feature.spot_perp_close_basis']
    const raw = JSON.stringify({features:{'feature.spot_perp_close_basis':{dtype:'number',unit:'signed_fraction',description:'Closed trade-bar comparison',availability:scope}}})
    const projected = projectRegistry(raw,{featureIds:['spot_perp_close_basis'],compact:true})
    expect(projected).not.toBeNull()
    expect(JSON.stringify(projected)).toContain('availability')
    expect(JSON.stringify(projected)).toContain(scope.from)
    expect(JSON.stringify(projected)).toContain(scope.to)
    expect(JSON.stringify(projected)).toContain('solusdt')
  })
})
