/* eslint-disable no-unused-vars */
module.exports = {
    up: (queryInterface, Sequelize) => {
        return queryInterface
            .addColumn('tron_user', 'tron_addr_create_count', {
                after: 'tip_count',
                type: Sequelize.INTEGER.UNSIGNED,
                defaultValue: 0,
                allowNull: false,
            })
            .then(() => {
                queryInterface.addColumn('tron_user', 'tron_addr_create_time', {
                    after: 'is_new_user',
                    type: Sequelize.DATE,
                    defaultValue: null,
                    allowNull: true,
                });
            });
    },
    down: (queryInterface, Sequelize) => {
        return queryInterface
            .removeColumn('tron_user', 'tron_addr_create_count')
            .then(() => {
                queryInterface.removeColumn(
                    'tron_user',
                    'tron_addr_create_time'
                );
            });
    },
};
