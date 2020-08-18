module.exports = {
    up: (queryInterface, Sequelize) => {
        return queryInterface.createTable('tron_transfer_state', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.BIGINT.UNSIGNED,
            },
            process_status: {
                allowNull: false,
                type: Sequelize.BOOLEAN,
                defaultValue: 0,
            },
            delay_count: {
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
        });
    },
    // eslint-disable-next-line no-unused-vars
    down: (queryInterface, Sequelize) => {
        return queryInterface.dropTable('tron_transfer_state');
    },
};
