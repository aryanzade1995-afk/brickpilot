import test from 'node:test'
import assert from 'node:assert/strict'
import { detectUserCity, reverseGeocodeCoordinates } from '../src/lib/location/detectLocation.ts'

test('detectLocation: Gracefully returns error in Node/headless environment without navigator.geolocation', async () => {
  const result = await detectUserCity()
  assert.equal(result.success, false)
  assert.ok(result.error)
  assert.match(result.error, /not supported/i)
})

test('detectLocation: reverseGeocodeCoordinates parses valid response cleanly', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        city: 'Pune',
        locality: 'Shivajinagar',
        principalSubdivision: 'Maharashtra',
        postcode: '411005',
        countryName: 'India',
        countryCode: 'IN',
      }),
    })

    const parsed = await reverseGeocodeCoordinates(18.5204, 73.8567)
    assert.equal(parsed.city, 'Pune')
    assert.equal(parsed.state, 'Maharashtra')
    assert.equal(parsed.pincode, '411005')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('detectLocation: reverseGeocodeCoordinates falls back to locality or principalSubdivision if city is blank', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        city: '',
        locality: 'Mulshi Rural',
        principalSubdivision: 'Maharashtra',
        postcode: '412108',
      }),
    })

    const parsed = await reverseGeocodeCoordinates(18.5, 73.5)
    assert.equal(parsed.city, 'Mulshi Rural')
    assert.equal(parsed.pincode, '412108')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('detectLocation: reverseGeocodeCoordinates handles HTTP error response gracefully', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 503,
    })

    await assert.rejects(
      async () => reverseGeocodeCoordinates(18.5, 73.5),
      /Reverse geocoding failed with status 503/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

