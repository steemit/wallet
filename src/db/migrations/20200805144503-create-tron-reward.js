module.exports = {
    up: (queryInterface, Sequelize) => {
        return queryInterface
            .createTable('tron_reward', {
                id: {
                    allowNull: false,
                    autoIncrement: true,
                    primaryKey: true,
                    type: Sequelize.BIGINT.UNSIGNED,
                },
                username: {
                    allowNull: false,
                    type: Sequelize.STRING(16),
                },
                tron_addr: {
                    allowNull: true,
                    type: Sequelize.CHAR(34),
                },
                block_num: {
                    allowNull: false,
                    type: Sequelize.INTEGER.UNSIGNED,
                },
                steem_tx_id: {
                    allowNull: false,
                    type: Sequelize.CHAR(40),
                },
                reward_vests: {
                    allowNull: false,
                    type: Sequelize.BIGINT.UNSIGNED,
                },
                reward_steem: {
                    allowNull: false,
                    type: Sequelize.BIGINT.UNSIGNED,
                },
                reward_sbd: {
                    allowNull: false,
                    type: Sequelize.BIGINT.UNSIGNED,
                },
                vests_per_steem: {
                    allowNull: false,
                    type: Sequelize.FLOAT,
                },
                created_at: {
                    allowNull: false,
                    type: Sequelize.DATE,
                },
                updated_at: {
                    allowNull: false,
                    type: Sequelize.DATE,
                },
            })
            .then(() => {
                queryInterface.addIndex('tron_reward', ['username']);
                queryInterface.addIndex('tron_reward', ['tron_addr']);
                queryInterface.addIndex('tron_reward', ['block_num']);
                queryInterface.addIndex('tron_reward', ['steem_tx_id']);
            });
    },
    // eslint-disable-next-line no-unused-vars
    down: (queryInterface, Sequelize) => {
        return queryInterface.dropTable('tron_reward');
    },
};
