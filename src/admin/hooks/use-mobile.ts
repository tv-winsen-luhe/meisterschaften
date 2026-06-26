import * as React from 'react'

const MOBILE_BREAKPOINT = 768

export const useIsMobile = () => {
  // Initialise from the viewport synchronously. The admin is a client:only island (no SSR), so
  // window exists on the first render — this avoids the undefined→false flash that would briefly
  // mis-render the mobile drawer / sidebar before the effect runs.
  const [isMobile, setIsMobile] = React.useState(
    () => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener('change', onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
