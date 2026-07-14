export default {
    id: 'run',
    label: '跑步 (Run)',
    category: 'movement',
    defaultFrameCount: 6,
    looping: true,
    skipReferenceFrame: true,

    prompt: {
        motion: 'run cycle: the character runs in place at a moderate, steady pace. Legs move in a compact running stride with feet close to the ground. Arms swing opposite to legs in a controlled manner. Hair and loose clothing sway gently with the rhythm. The motion is energetic but stable and grounded.',
        groundRule: 'strict',
        extraRules: [
            'Use COMPACT, SHORT strides — pixel-art platformer style. NO exaggerated wide leg splits, NO lunging, NO sprinting posture.',
            'The weapon is HELD FIRMLY in the SAME hand as the reference (Cell 1), pointing in the SAME direction — it moves ONLY as the arm naturally moves. Do NOT flip, mirror, or reverse the weapon in any frame. NO wild swinging, NO weapon blur or trail.',
            'Arms swing subtly opposite to legs — small, controlled arcs close to the body.',
            'Torso stays mostly upright with MINIMAL vertical bounce — head height is nearly constant.',
            'Each frame must show a clearly distinct but NOT extreme leg position in the run cycle.',
            'Keep the character\'s overall silhouette and proportions consistent across all frames.'
        ]
    },

    postProcess: {
        alignMode: 'bottom',
        horizontalAlign: 'center',
        defaultAlphaThreshold: 10,
        customFn: null
    },

    ui: {
        tips: '跑步循环，紧凑步幅，武器固定，底部+水平对齐',
        extraControls: []
    }
};
