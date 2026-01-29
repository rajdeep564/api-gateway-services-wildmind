
import WebSocket from 'ws';

const projectId = `test-project-${Date.now()}`; // Use unique project ID to start clean
const ws = new WebSocket(`ws://localhost:5001/realtime?projectId=${projectId}`);

let initCount = 0;

ws.on('open', () => {
    console.log(`Connected to project: ${projectId}`);

    // 1. Create Item
    const createOp = {
        type: 'create',
        data: {
            element: {
                id: 'test-item-1',
                type: 'image',
                x: 100,
                y: 100
            }
        },
        id: `op-create-${Date.now()}`,
        authorId: 'test'
    };

    console.log('Sending Create Op...');
    ws.send(JSON.stringify({
        kind: 'history.push',
        op: createOp,
        inverse: { type: 'delete', elementId: 'test-item-1', data: {}, authorId: 'test' }
    }));

    // Wait for create to settle
    setTimeout(() => {
        // 2. Delete Item (Bulk style)
        const deleteOp = {
            type: 'delete',
            elementIds: ['test-item-1'],
            data: {},
            id: `op-delete-${Date.now()}`,
            authorId: 'test'
        };

        console.log('Sending Delete Op...');
        ws.send(JSON.stringify({
            kind: 'history.push',
            op: deleteOp,
            inverse: { type: 'bulk-create', data: { elements: [createOp.data.element] }, authorId: 'test' }
        }));

        // Wait and check state
        setTimeout(() => {
            console.log('Sending Init (Simulate Refresh)...');
            ws.send(JSON.stringify({ kind: 'init' }));
        }, 500);

    }, 500);
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'init') {
        initCount++;
        console.log(`Received Init #${initCount}`);

        // First init is effectively empty for a new project ID
        if (initCount === 1) {
            console.log('First init received (should be empty)');
            return;
        }

        const hasItem = msg.overlays.some((o: any) => o.id === 'test-item-1') || msg.media.some((m: any) => m.id === 'test-item-1');
        console.log(`State received (Init #${initCount}). Item exists?`, hasItem);
        console.log('Overlays count:', msg.overlays.length);
        console.log('Media count:', msg.media.length);
        if (msg.overlays.length > 0) console.log('Overlays:', msg.overlays);
        if (msg.media.length > 0) console.log('Media:', msg.media);

        if (hasItem) {
            console.error('FAIL: Item was NOT deleted!');
            process.exit(1);
        } else {
            console.log('SUCCESS: Item was deleted.');
            process.exit(0);
        }
    }
});
