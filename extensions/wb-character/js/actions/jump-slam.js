export default {
    id: 'jump_slam',
    label: '起跳砸地 (Jump Slam)',
    category: 'combat',
    defaultFrameCount: 7,
    looping: false,

    prompt: {
        motion: 'jump slam attack: the character crouches, leaps high into the air, raises weapon overhead at the peak, then slams down with a powerful ground strike. Show impact effect on landing.',
        groundRule: 'free',
        extraRules: [
            'Frame 1: crouching preparation (legs bend, body lowers).',
            'Frame 2: launch upward (feet leave the ground, body rising).',
            'Frame 3-4: peak of the jump (character at HIGHEST point, weapon raised overhead). The character should be visibly elevated — feet well above the ground line.',
            'Frame 5: descending rapidly, weapon swinging downward.',
            'Frame 6: moment of impact — weapon hits ground, show shockwave/dust effect at feet.',
            'Frame 7: recovery stance after landing (crouched, weapon down).',
            'The vertical arc must be smooth and clearly show height variation between frames.',
            'Horizontal position must remain perfectly consistent — NO left/right drift.'
        ]
    },

    postProcess: {
        alignMode: 'top',
        horizontalAlign: 'center',
        defaultAlphaThreshold: 10,
        customFn: null
    },

    ui: {
        tips: '角色腾空，使用顶部对齐保留跳跃弧线高度差',
        extraControls: [
            { id: 'peakHeight', label: '最高点占格子高度 (%)', type: 'range', min: 20, max: 80, default: 40 }
        ]
    }
};
