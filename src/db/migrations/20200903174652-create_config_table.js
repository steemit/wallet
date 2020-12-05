module.exports = {
    up: (queryInterface, Sequelize) => {
        return queryInterface.createTable('config', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER.UNSIGNED,
            },
            config_key: {
                allowNull: false,
                type: Sequelize.TEXT,
                defaultValue: 0,
            },
            config_value: {
                allowNull: false,
                defaultValue: 0,
                type: Sequelize.TEXT,
            },
        });
    },
    // eslint-disable-next-line no-unused-vars
    down: (queryInterface, Sequelize) => {
        return queryInterface.dropTable('config');
    },
};
