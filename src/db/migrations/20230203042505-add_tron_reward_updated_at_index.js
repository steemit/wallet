module.exports = {
    up: (queryInterface, Sequelize) =>
        queryInterface.addIndex('tron_reward', ['updated_at']),
    // eslint-disable-next-line no-unused-vars
    down: (queryInterface, Sequelize) =>
        queryInterface.removeIndex('tron_reward', ['updated_at']),
};
