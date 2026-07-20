export default {
    id: 'hit',
    label: '受击 (Hit)',
    category: 'combat',
    defaultFrameCount: 4,
    looping: false,

    prompt: {
        motion: 'hit reaction: the character flinches backward from taking damage, shows pain, then partially recovers to a ready stance.',
        groundRule: 'strict',
        extraRules: [
            'Frame 1: moment of impact (slight lean back). Frame 2: peak flinch (body bent backward). Frames 3-4: recovery back toward standing.',
            'Keep feet planted — the flinch is upper body only.',
            'Optional: brief flash/blink effect on the character to indicate damage.'
        ]
    },

    postProcess: {
        alignMode: 'bottom',
        horizontalAlign: 'none',
        defaultAlphaThreshold: 10,
        customFn: null
    },

    ui: {
        tips: '受击反馈，底部对齐',
        extraControls: []
    }
};
