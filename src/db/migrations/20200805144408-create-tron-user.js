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
                    defaultValue: 0,
                    type: Sequelize.BIGINT.UNSIGNED,
                },
                is_new_user: {
                    allowNull: false,
                    defaultValue: 0,
                    type: Sequelize.BOOLEAN,
                },
                is_tron_addr_actived: {
                    allowNull: false,
                    defaultValue: 0,
                    type: Sequelize.BOOLEAN,
                },
                tran_addr_active_time: {
                    allowNull: true,
                    type: Sequelize.DATE,
                },
                tip_count: {
                    allowNull: false,
                    defaultValue: 0,
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
                    unique: true,
                });
                queryInterface.addIndex('tron_user', ['tron_addr']);
            });
    },
    // eslint-disable-next-line no-unused-vars
    down: (queryInterface, Sequelize) => {
        return queryInterface.dropTable('tron_user');
    },
};
