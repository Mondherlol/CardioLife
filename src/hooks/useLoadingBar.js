import { useEffect } from 'react'
import NProgress from 'nprogress'

NProgress.configure({ showSpinner: false, speed: 300, trickleSpeed: 80 })

export function useLoadingBar(loading) {
  useEffect(() => {
    if (loading) NProgress.start()
    else         NProgress.done()
    return () => NProgress.done()
  }, [loading])
}
