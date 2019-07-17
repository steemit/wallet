'use strict';

module.exports = {
    up: function(queryInterface, Sequelize) {
        queryInterface.removeIndex('accounts', ['name']);
        return queryInterface.addIndex('accounts', ['name']);
    },

    down: function(queryInterface, Sequelize) {},
};
