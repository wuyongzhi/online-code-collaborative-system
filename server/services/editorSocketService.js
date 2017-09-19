const redisClient = require('../modules/redisClient');
const TIMEOUT_IN_SECONDS = 3600;

module.exports = function(io) {
    const collaborations = {}; // TODO: problemId > roomId, roomSerialNum > participants + cachedInstructions
    const socketIdToProblemId = {};
    const sessionPath = '/ojserver/'; // for redis

    io.on('connection', (socket) => {
        console.log("**********************");
        console.log(collaborations);
        socket.emit('getProblemsAndRooms', collaborations);
    });

    io.of('/problemEditor').on('connection', (socket) => {
        console.log("######### " + socket.id + " connected ############");        
        const problemId = socket.handshake.query['problemId'];
        socketIdToProblemId[socket.id] = problemId;

        // if (!(problemId in collaborations)) {
        //     collaborations[problemId] = {
        //         'participants': []
        //     };
        // }

        if (problemId in collaborations) {
            // there are users working on the code
            collaborations[problemId]['participants'].push(socket.id);
        } else {
            // there is no user working on the code, check redis first
            redisClient.get(sessionPath + problemId, function(data) {
                if (data) {
                    // there were users working on this code before
                    // pull the history data
                    console.log('session terminated previously, pulling back...');
                    collaborations[problemId] = {
                        'roomSerialNum': 0,
                        'cachedInstructions': JSON.parse(data),
                        'participants': []
                    }
                } else {
                    console.log('you are the first one ever worked on this problem')
                    collaborations[problemId] = {
                        'roomSerialNum': 0,
                        'cachedInstructions': [],
                        'participants': []
                    }
                }
                
                collaborations[problemId]['participants'].push(socket.id);
                console.log(collaborations);
                io.emit('getProblemsAndRooms', collaborations);
            });
        }
        console.log(collaborations);
        io.emit('getProblemsAndRooms', collaborations);

        socket.on('change', delta => {
            console.log('change' + socketIdToProblemId[socket.id] + ' ' + delta);
            // put change into collaboration cachedInstruction
            const problemId = socketIdToProblemId[socket.id];
            if (problemId in collaborations) {
                collaborations[problemId]['cachedInstructions'].push(
                    ['change', delta, Date.now()]
                );
            }
            // emit change to everyone else
            forwardEvent(socket.id, 'change', delta);
        });

        socket.on('cursorMove', (cursor) => {
            console.log('change ' + socketIdToProblemId[socket.id] + ' ' + cursor);
            cursor = JSON.parse(cursor);
            // add socketId to the cursor object

            cursor['socketId'] = socket.id;

            // forward the cursor move event to everyone else working on the same session
            forwardEvent(socket.id, 'cursorMove', JSON.stringify(cursor));
        });

        socket.on('restoreBuffer', () => {
            const problemId = socketIdToProblemId[socket.id];
            if (problemId in collaborations) {
                const cachedInstructions = collaborations[problemId]['cachedInstructions'];
                for (let ins of cachedInstructions) {
                    // send ('change', delta) to client
                    socket.emit(ins[0], ins[1]);
                }
            } else {
                console.log('There is a bug!');
            }
        });

        socket.on('disconnect', () => {
            const problemId = socketIdToProblemId[socket.id];

            let foundAndRemove = false;
            if (problemId in collaborations) {
                const participants = collaborations[problemId]['participants'];
                const index = participants.indexOf(socket.id);

                if (index >= 0) {
                    // remove this left user
                    participants.splice(index, 1); 
                    foundAndRemove = true;

                    if (participants.length === 0) {
                        const key = sessionPath + problemId;
                        const value = JSON.stringify(collaborations[problemId]['cachedInstructions']);

                        redisClient.set(key, value, redisClient.redisPrint);
                        redisClient.expire(key, TIMEOUT_IN_SECONDS);
                        delete collaborations[problemId];
                    }
                } else {
                    console.log('Error: user doesn\'t exist!');
                }

                if (!foundAndRemove) {
                    console.log('Error: user not found!');
                }
            }
            console.log(collaborations);
            io.emit('getProblemsAndRooms', collaborations);
        });
    });

    const forwardEvent = function(socketId, eventName, dataString) {
        const problemId = socketIdToProblemId[socketId];
        if (problemId in collaborations) {
            const participants = collaborations[problemId]['participants'];
            for (let item of participants) {
                if (socketId != item) {
                    io.to(item).emit(eventName, dataString);
                }
            }
        } else {
            console.log('There is a bug');
        }
    }
}