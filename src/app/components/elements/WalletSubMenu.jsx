import React from 'react';
import { Link } from 'react-router';
import tt from 'counterpart';

export default ({ accountname, isMyAccount, showTab }) => {
    return (
        <ul className="WalletSubMenu menu">
            <li>
                <Link
                    to={`/@${accountname}/transfers`}
                    activeClassName="active"
                >
                    {tt('g.balances')}
                </Link>
            </li>
            <li>
                <Link
                    to={`/@${accountname}/delegations`}
                    activeClassName="active"
                >
                    {tt('g.delegations')}
                </Link>
            </li>
            {isMyAccount || showTab == 'permissions' ? (
                <li>
                    <Link
                        to={`/@${accountname}/permissions`}
                        activeClassName="active"
                    >
                        {tt('g.permissions')}
                    </Link>
                </li>
            ) : null}
            {isMyAccount || showTab == 'password' ? (
                <li>
                    <Link
                        to={`/@${accountname}/password`}
                        activeClassName="active"
                    >
                        {tt('g.change_password')}
                    </Link>
                </li>
            ) : null}
            {isMyAccount || showTab == 'communities' ? (
                <li>
                    <Link
                        to={`/@${accountname}/communities`}
                        activeClassName="active"
                    >
                        {tt('g.communities')}
                    </Link>
                </li>
            ) : null}
            <li>
                <Link
                    to={`/@${accountname}/witnesses`}
                    activeClassName="active"
                >
                    {tt('navigation.witnesses')}
                </Link>
            </li>
            <li>
                <Link
                    to={`/@${accountname}/proposals`}
                    activeClassName="active"
                >
                    {tt('g.proposals')}
                </Link>
            </li>
        </ul>
    );
};
