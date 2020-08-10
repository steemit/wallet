/* eslint-disable lines-around-directive */
module.exports = (sequelize, DataTypes) => {
    const tronUser = sequelize.define(
        'TronUser',
        {
            username: {
                allowNull: false,
                type: DataTypes.STRING,
            },
            tron_addr: {
                allowNull: true,
                type: DataTypes.CHAR,
            },
            pending_claim_tron_reward: {
                allowNull: false,
                type: DataTypes.BIGINT.UNSIGNED,
                get() {
                    return `${this.getDataValue('pending_claim_tron_reward') /
                        1e5}`;
                },
                set(v) {
                    this.setDataValue(
                        'pending_claim_tron_reward',
                        parseInt(v * 1e5, 10)
                    );
                },
            },
            is_new_user: {
                allowNull: false,
                type: DataTypes.BOOLEAN,
            },
            is_tron_addr_actived: {
                allowNull: false,
                type: DataTypes.BOOLEAN,
            },
            tran_addr_active_time: {
                allowNull: false,
                type: DataTypes.DATE,
            },
            tip_count: {
                allowNull: false,
                type: DataTypes.INTEGER.UNSIGNED,
            },
        },
        {
            tableName: 'tron_user',
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            timestamps: true,
            underscored: true,
        }
    );
    tronUser.getCacheFields = () => [
        'tron_addr',
        'tip_count',
        'pending_claim_tron_reward',
    ];
    tronUser.getCachePrefix = () => 'tron_user_';
    return tronUser;
};
