export function portrait(stage) {
  const s = Math.max(1, Math.min(5, Number(stage) || 1));
  return `<svg viewBox="0 0 260 220" aria-hidden="true" class="lumi-art" data-lumi-stage="${s}">
 <g class="lumi-shadow-position"><ellipse class="lumi-shadow" cx="130" cy="192" rx="76" ry="12" fill="#c3e2d5"/></g>
 <circle cx="130" cy="105" r="87" fill="#e2f4e9"/>
 <g class="lumi-sparks" fill="#e7b354"><path d="m44 65 3-9 3 9 9 3-9 3-3 9-3-9-9-3Z"/><path d="m213 131 2-7 2 7 7 2-7 2-2 7-2-7-7-2Z"/></g>
 <g class="lumi-position"><g class="lumi-action"><g class="lumi-sway"><g class="lumi-body">
 ${s >= 4 ? '<g class="lumi-wing-left"><path d="M88 130Q22 70 38 157Q48 180 87 164" fill="#56b59b" stroke="#247c6a" stroke-width="3"/></g><g class="lumi-wing-right"><path d="M172 130Q238 70 222 157Q212 180 173 164" fill="#56b59b" stroke="#247c6a" stroke-width="3"/></g>' : ""}
 ${s >= 2 ? `<path d="M83 98Q${s >= 3 ? "44 20 101 65" : "59 44 106 76"}L112 106M177 98Q${s >= 3 ? "216 20 159 65" : "201 44 154 76"}L148 106" fill="#53b39c" stroke="#247c6a" stroke-width="3"/>` : ""}
 ${s === 5 ? '<path d="m98 51-8-24 25 12 15-23 15 23 25-12-8 24Z" fill="#f2c568" stroke="#b67e26" stroke-width="3"/><circle cx="130" cy="42" r="5" fill="#fff3ca"/>' : ""}
 <path d="M73 138C67 90 90 65 130 65S193 90 187 138L180 161C175 189 85 189 80 161Z" fill="${s >= 4 ? "#2e9b85" : "#77cdb0"}" stroke="#247c6a" stroke-width="3"/>
 <g class="lumi-rest-arm"><path d="M78 137Q63 137 62 149" fill="none" stroke="#247c6a" stroke-width="10" stroke-linecap="round"/></g>
 <g class="lumi-wave-arm"><path d="M182 137Q198 138 201 125" fill="none" stroke="#247c6a" stroke-width="10" stroke-linecap="round"/></g>
 <ellipse cx="130" cy="146" rx="38" ry="32" fill="#d8f3d8"/>
 ${s >= 3 ? '<path d="M125 151l5 5 10-13" fill="none" stroke="#278773" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' : ""}
 <g class="lumi-gaze"><g class="lumi-eyes"><ellipse cx="107" cy="108" rx="10" ry="12" fill="#f9fffb"/><ellipse cx="153" cy="108" rx="10" ry="12" fill="#f9fffb"/><g class="lumi-pupils" fill="#163e3b"><ellipse cx="107" cy="109" rx="6" ry="8"/><ellipse cx="153" cy="109" rx="6" ry="8"/><circle cx="109" cy="105" r="2" fill="white"/><circle cx="155" cy="105" r="2" fill="white"/></g></g></g>
 <g class="lumi-delighted-eyes" fill="none" stroke="#163e3b" stroke-width="3" stroke-linecap="round"><path d="M99 110q8-12 16 0M145 110q8-12 16 0"/></g>
 <ellipse cx="93" cy="123" rx="10" ry="5" fill="#ecaaa2"/><ellipse cx="167" cy="123" rx="10" ry="5" fill="#ecaaa2"/>
 <path class="lumi-smile" d="M120 122q10 12 20 0" fill="none" stroke="#163e3b" stroke-width="3" stroke-linecap="round"/>
 ${s === 1 ? '<path d="m73 139 19-10 16 13 19-11 18 12 19-14 23 10-6 31q-8 33-51 28-43 5-51-28Z" fill="#fff4db" stroke="#ceb98b" stroke-width="3"/><path d="m110 160 9 7-6 11" fill="none" stroke="#dbc79e" stroke-width="3"/>' : '<g class="lumi-foot-left"><ellipse cx="95" cy="179" rx="19" ry="10" fill="#247c6a"/></g><g class="lumi-foot-right"><ellipse cx="165" cy="179" rx="19" ry="10" fill="#247c6a"/></g>'}
 ${s >= 2 && s < 5 ? `<path class="lumi-sprout" d="M130 68V46M130 57Q102 56 110 35Q132 35 130 57${s >= 3 ? "M130 53Q151 26 159 43Q152 61 130 57" : ""}" fill="#b0db7e" stroke="#4b8d57" stroke-width="3" stroke-linecap="round"/>` : ""}
 </g></g></g></g></svg>`;
}
