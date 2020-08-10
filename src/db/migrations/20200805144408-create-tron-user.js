module.exports = {
    up: (queryInterface, Sequelize) => {
        return queryInterface
            .createTable('tron_user', {
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
                pending_claim_tron_reward: {
                    allowNull: false,
                    type: Sequelize.BIGINT.UNSIGNED,
                },
                is_new_user: {
                    allowNull: false,
                    type: Sequelize.BOOLEAN,
                },
                is_tron_addr_actived: {
                    allowNull: false,
                    type: Sequelize.BOOLEAN,
                },
                tran_addr_active_time: {
                    allowNull: false,
                    type: Sequelize.DATE,
                },
                tip_count: {
                    allowNull: false,
                    type: Sequelize.INTEGER.UNSIGNED,
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
                queryInterface.addIndex('tron_user', ['username'], {
                    indicesType: 'UNIQUE',
                });
                queryInterface.addIndex('tron_user', ['tron_addr']);
            });
    },
    // eslint-disable-next-line no-unused-vars
    down: (queryInterface, Sequelize) => {
        return queryInterface.dropTable('tron_user');
    },
};
