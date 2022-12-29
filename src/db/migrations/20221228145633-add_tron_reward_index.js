module.exports = {
    up: (queryInterface, Sequelize) => {
        return queryInterface.addIndex('tron_reward', ['status']).then(() => {
            return queryInterface.addIndex('tron_reward', ['created_at']);
        });
    },
    // eslint-disable-next-line no-unused-vars
    down: (queryInterface, Sequelize) => {
        return queryInterface
            .removeIndex('tron_reward', ['status'])
            .then(() => {
                return queryInterface.removeIndex('tron_reward', [
                    'created_at',
                ]);
            });
    },
};
