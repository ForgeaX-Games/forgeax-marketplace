class ActionRegistry {
    constructor() {
        this._actions = new Map();
    }

    register(plugin) {
        if (!plugin.id || !plugin.label) {
            throw new Error(`Action plugin must have 'id' and 'label': ${JSON.stringify(plugin)}`);
        }
        this._actions.set(plugin.id, plugin);
    }

    get(id) {
        return this._actions.get(id);
    }

    getAll() {
        return Array.from(this._actions.values());
    }

    getByCategory(category) {
        return this.getAll().filter(a => a.category === category);
    }

    getCategories() {
        const order = ['basic', 'movement', 'combat', 'special'];
        const cats = [...new Set(this.getAll().map(a => a.category))];
        return cats.sort((a, b) => {
            const ia = order.indexOf(a);
            const ib = order.indexOf(b);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });
    }

    getIds() {
        return Array.from(this._actions.keys());
    }
}

export const registry = new ActionRegistry();
