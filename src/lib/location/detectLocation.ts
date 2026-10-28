export interface DetectedLocationResult {
  success: boolean
  city?: string
  state?: string
  pincode?: string
  error?: string
}

interface BigDataCloudReverseResponse {
  city?: string
  locality?: string
  principalSubdivision?: string
  postcode?: string
  countryName?: string
  countryCode?: string
}

/**
 * Reverse-geocode latitude and longitude into Indian city, state, and pincode.
 * Uses BigDataCloud client API (CORS-friendly, no API key required, HTTPS safe).
 */
export async function reverseGeocodeCoordinates(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<{ city: string; state?: string; pincode?: string }> {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
  
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) {
    throw new Error(`Reverse geocoding failed with status ${response.status}`)
  }

  const data = (await response.json()) as BigDataCloudReverseResponse
  const city = data.city || data.locality || data.principalSubdivision || ''
  const state = data.principalSubdivision || undefined
  const pincode = data.postcode?.trim() || undefined

  if (!city) {
    throw new Error('Could not identify a city name from the given coordinates')
  }

  return { city, state, pincode }
}

/**
 * Request user location via browser navigator.geolocation and reverse-geocode to city.
 * Safe against permission denials, timeouts, and unencrypted HTTP contexts.
 */
export async function detectUserCity(): Promise<DetectedLocationResult> {
  if (typeof window === 'undefined' || !navigator.geolocation) {
    return {
      success: false,
      error: 'Geolocation is not supported by your browser',
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 9000)

  try {
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 300000, // 5 minutes cache
      })
    })

    const { latitude, longitude } = position.coords
    const geocoded = await reverseGeocodeCoordinates(latitude, longitude, controller.signal)

    clearTimeout(timeoutId)
    return {
      success: true,
      city: geocoded.city,
      state: geocoded.state,
      pincode: geocoded.pincode,
    }
  } catch (err: unknown) {
    clearTimeout(timeoutId)
    if (err && typeof err === 'object' && 'code' in err) {
      const geoErr = err as GeolocationPositionError
      switch (geoErr.code) {
        case geoErr.PERMISSION_DENIED:
          return { success: false, error: 'Location permission denied. Please enter your city manually.' }
        case geoErr.POSITION_UNAVAILABLE:
          return { success: false, error: 'Location unavailable. Please enter your city manually.' }
        case geoErr.TIMEOUT:
          return { success: false, error: 'Location request timed out. Please enter your city manually.' }
      }
    }

    if (err instanceof DOMException && err.name === 'AbortError') {
      return { success: false, error: 'Location lookup timed out. Please enter your city manually.' }
    }

    const message = err instanceof Error ? err.message : 'Failed to detect location'
    return { success: false, error: message }
  }
}

