import React from 'react'
import { createRoot } from 'react-dom/client'
import { NeonLoop } from './neon-loop'

const target = document.querySelector('#neon-loop-root')
if (target) {
  createRoot(target).render(
    <NeonLoop
      text="SHAURYAA · "
      font="Arial, Helvetica, sans-serif"
      fontWeight={900}
      colors={["#37ecff", "#9b8cff", "#ff4ea5", "#ffb27a"]}
      background="transparent"
      halo="#000000"
      glow={0.32}
      speed={0.55}
      tilt={8}
      depth={0.28}
      interactive={true}
      style={{ width: '150%', height: '150%', marginLeft: '-25%', marginTop: '-25%' }}
    />
  )
}
