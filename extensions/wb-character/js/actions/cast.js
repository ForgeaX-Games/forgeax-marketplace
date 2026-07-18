export default {
    id: 'cast',
    label: '施法 (Cast)',
    category: 'combat',
    defaultFrameCount: 6,
    looping: false,

    prompt: {
        motion: 'spell cast: the character raises hands/weapon, channels energy with a brief glow, and releases the spell. Show the full casting sequence from buildup to release.',
        groundRule: 'strict',
        extraRules: [
            'Frame 1: ready stance. Frame 2: raise hands/weapon. Frames 3-4: channeling energy (show glow effect). Frames 5-6: release and recovery.',
            'Feet stay planted throughout the casting animation.'
        ]
    },

    postProcess: {
        alignMode: 'bottom',
        horizontalAlign: 'none',
        defaultAlphaThreshold: 10,
        customFn: null
    },

    ui: {
        tips: '施法释放全流程，底部对齐',
        extraControls: []
    }
};
